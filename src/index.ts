#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Pedra } from "@pedra-ai/sdk";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server";

async function main(): Promise<void> {
  const apiKey = process.env.PEDRA_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "PEDRA_API_KEY is not set. Add it to your MCP client config's `env` block. " +
        "Get your key at https://app.pedra.ai.\n",
    );
    process.exit(1);
  }

  const client = new Pedra(apiKey);
  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdio carries the MCP protocol on stdout — only log to stderr.
  process.stderr.write(
    `${SERVER_NAME} MCP server v${SERVER_VERSION} running on stdio.\n`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(1);
});
