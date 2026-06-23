const { test } = require("node:test");
const assert = require("node:assert");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { PedraApiError } = require("@pedra-ai/sdk");
const { createServer } = require("../dist/server.js");

const EXPECTED_TOOLS = [
  "pedra_enhance",
  "pedra_enhance_and_correct_perspective",
  "pedra_empty_room",
  "pedra_furnish",
  "pedra_renovation",
  "pedra_edit_via_prompt",
  "pedra_sky_blue",
  "pedra_remove_object",
  "pedra_blur",
  "pedra_create_video",
  "pedra_credits",
  "pedra_feedback",
];

function fakeClient(overrides = {}) {
  const img = (url) => ({ message: "ok", url, urls: [url], raw: {} });
  return {
    enhance: async () => img("https://img.pedra.ai/enhanced"),
    enhanceAndCorrectPerspective: async () => img("https://img.pedra.ai/persp"),
    empty: async () => img("https://img.pedra.ai/empty"),
    furnish: async () => img("https://img.pedra.ai/furnish"),
    renovation: async () => img("https://img.pedra.ai/reno"),
    editViaPrompt: async () => img("https://img.pedra.ai/edit"),
    sky: async () => img("https://img.pedra.ai/sky"),
    remove: async () => img("https://img.pedra.ai/remove"),
    blur: async () => img("https://img.pedra.ai/blur"),
    createVideo: async () => ({
      message: "done",
      videoId: "v1",
      videoUrl: "https://img.pedra.ai/video.mp4",
      raw: {},
    }),
    credits: async () => ({ plan: "pro", creditsRemaining: 42, raw: {} }),
    feedback: async () => ({ message: "thanks", creditedBack: true, raw: {} }),
    ...overrides,
  };
}

async function connect(client) {
  const server = createServer(client);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    mcp.connect(clientTransport),
  ]);
  return mcp;
}

function textOf(result) {
  return (result.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

test("exposes exactly the 12 endpoint tools", async () => {
  const mcp = await connect(fakeClient());
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepStrictEqual(names, [...EXPECTED_TOOLS].sort());
  for (const t of tools) {
    assert.ok(t.description && t.description.length > 0, `${t.name} has a description`);
  }
});

test("credits returns plan + remaining", async () => {
  const mcp = await connect(fakeClient());
  const res = await mcp.callTool({ name: "pedra_credits", arguments: {} });
  assert.ok(!res.isError);
  const text = textOf(res);
  assert.match(text, /pro/);
  assert.match(text, /42/);
});

test("enhance returns the asset URL and is not an error", async () => {
  const mcp = await connect(fakeClient());
  const res = await mcp.callTool({
    name: "pedra_enhance",
    arguments: { imageUrl: "https://example.com/room.jpg" },
  });
  assert.ok(!res.isError);
  assert.match(textOf(res), /https:\/\/img\.pedra\.ai\/enhanced/);
});

test("create_video returns the finished video URL", async () => {
  const mcp = await connect(fakeClient());
  const res = await mcp.callTool({
    name: "pedra_create_video",
    arguments: { images: [{ imageUrl: "https://example.com/a.jpg" }] },
  });
  assert.ok(!res.isError);
  assert.match(textOf(res), /video\.mp4/);
});

test("API errors surface as tool errors, not crashes", async () => {
  const mcp = await connect(
    fakeClient({
      enhance: async () => {
        throw new PedraApiError("Insufficient credits", 402);
      },
    }),
  );
  const res = await mcp.callTool({
    name: "pedra_enhance",
    arguments: { imageUrl: "https://example.com/room.jpg" },
  });
  assert.strictEqual(res.isError, true);
  const text = textOf(res);
  assert.match(text, /Insufficient credits/);
  assert.match(text, /402/);
});

test("invalid input (missing required imageUrl) is rejected", async () => {
  const mcp = await connect(fakeClient());
  const res = await mcp.callTool({
    name: "pedra_edit_via_prompt",
    arguments: { prompt: "make it brighter" },
  });
  assert.strictEqual(res.isError, true);
});
