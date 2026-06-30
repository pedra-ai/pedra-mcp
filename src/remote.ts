#!/usr/bin/env node
/**
 * Remote (HTTP) entrypoint for the Pedra MCP server — the shape that Claude
 * chat (claude.ai web + mobile) and the Claude API MCP connector can reach.
 *
 * It reuses the EXACT same tool surface as the stdio server: `createServer()`
 * builds the same 16 `pedra_*` tools; only the transport and auth change.
 *
 *   stdio  (index.ts):  Claude Desktop launches this process, talks over stdin/stdout.
 *   remote (this file): a public HTTPS service Claude connects to by URL.
 *
 * Design choices (see the architecture notes in the team thread):
 *
 *  • Transport — Streamable HTTP, run STATELESS (`sessionIdGenerator: undefined`).
 *    Each `tools/call` is an independent POST; there is no long-lived
 *    server→client SSE stream and no session id. Pedra's tools are pure
 *    request-in/result-out, so statelessness costs nothing and it sidesteps
 *    the two problems a stateful server hits behind Meteor Galaxy's load
 *    balancer: sticky-session affinity across containers, and the ~120s idle
 *    timeout on long-lived connections.
 *
 *  • Auth — PATH A (bring-your-own-key), implemented here: the HTTP
 *    `Authorization: Bearer <token>` IS the caller's Pedra API key. Good enough
 *    to use from claude.ai as a custom connector today. PATH B (OAuth 2.1, for
 *    the one-click connector directory) slots in at `resolveApiKey()` — see the
 *    TODO there.
 *
 *  • Hosting — any Node 18+ HTTPS service. Can run as its own Galaxy app/
 *    container next to the web app, or anywhere (Cloud Run, Fly, …). Uses only
 *    Node's built-in `http` (no framework dependency); put TLS termination at
 *    the platform/proxy layer.
 */
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Pedra } from "@pedra-ai/sdk";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server";

const PORT = Number(process.env.PORT ?? 3000);
const MCP_PATH = "/mcp";
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB — tool args can include data: URIs

/** Write a JSON-RPC 2.0 error envelope (the shape MCP clients expect). */
function jsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

/** Read and JSON-parse the request body, capped at MAX_BODY_BYTES. */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Resolve the caller's Pedra API key from the request.
 *
 * PATH A (today): the bearer token IS the Pedra API key — the user pastes their
 * key when adding the custom connector. The server's existing key validation
 * (findUserByApiKey on the backend) does the rest, per request.
 *
 * PATH B (later, for the connector directory): replace the body of this
 * function with an OAuth 2.1 access-token exchange — verify the token, look up
 * the Pedra account it was issued to, and return THAT account's API key. The
 * authorization-server endpoints (/.well-known metadata, /authorize, /token)
 * live alongside the web app where the user accounts already are. The rest of
 * this file does not change.
 */
function resolveApiKey(req: IncomingMessage): string | null {
  const auth = req.headers["authorization"];
  const value = Array.isArray(auth) ? auth[0] : auth;
  const match = /^Bearer\s+(.+)$/i.exec((value ?? "").trim());
  return match ? match[1].trim() : null;
}

const httpServer = createHttpServer(async (req, res) => {
  const path = (req.url ?? "").split("?")[0];

  // Liveness probe (for the platform's health checks).
  if (path === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, server: SERVER_NAME, version: SERVER_VERSION }));
    return;
  }

  if (path !== MCP_PATH) {
    jsonRpcError(res, 404, -32601, "Not found");
    return;
  }

  // Stateless mode has no server→client stream and no sessions, so the GET/SSE
  // and DELETE/session-teardown verbs of Streamable HTTP don't apply.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    jsonRpcError(
      res,
      405,
      -32000,
      "Method not allowed — this server runs stateless Streamable HTTP; use POST.",
    );
    return;
  }

  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="pedra-mcp"');
    jsonRpcError(
      res,
      401,
      -32001,
      "Missing or invalid Authorization header. Send: Authorization: Bearer <PEDRA_API_KEY>",
    );
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    jsonRpcError(res, 400, -32700, "Invalid or oversized JSON body");
    return;
  }

  // Stateless: a fresh client + server + transport per request, scoped to this
  // caller's key and torn down when the response closes.
  const client = new Pedra(apiKey);
  const server = createServer(client);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    // Body already consumed above, so hand it to the transport explicitly.
    await transport.handleRequest(req, res, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[pedra-mcp] request error: ${message}\n`);
    if (!res.headersSent) {
      jsonRpcError(res, 500, -32603, "Internal server error");
    }
  }
});

httpServer.listen(PORT, () => {
  process.stdout.write(
    `${SERVER_NAME} remote MCP v${SERVER_VERSION} → http://0.0.0.0:${PORT}${MCP_PATH} ` +
      `(stateless Streamable HTTP, bring-your-own-key)\n`,
  );
});
