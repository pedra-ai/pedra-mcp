# Pedra MCP Server

Official [Model Context Protocol](https://modelcontextprotocol.io) server for the [Pedra API](https://pedra.ai/api-documentation) — use Pedra's AI real-estate photo editing (virtual staging, renovation, room emptying, enhancement, sky replacement, object removal/blur, and property videos) directly from **Claude, ChatGPT, Cursor**, and any other MCP client.

[![npm version](https://img.shields.io/npm/v/@pedra-ai/mcp.svg)](https://www.npmjs.com/package/@pedra-ai/mcp)
[![Official MCP registry](https://img.shields.io/badge/MCP%20registry-pedra--mcp-blue)](https://registry.modelcontextprotocol.io)

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=pedra&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBwZWRyYS1haS9tY3AiXSwiZW52Ijp7IlBFRFJBX0FQSV9LRVkiOiJZT1VSX1BFRFJBX0FQSV9LRVkifX0=)

It exposes **one tool per API endpoint**. Each tool is a single blocking call that returns the final asset URL(s) — there are no job IDs to poll.

## Quick start

You need a Pedra API key — get one from your [Pedra account](https://app.pedra.ai). The server reads it from the `PEDRA_API_KEY` environment variable.

The server runs over stdio and is published to npm, so most clients just run it with `npx` — no global install needed.

### Claude Desktop (one-click)

Download the latest **`pedra-mcp.mcpb`** from [Releases](https://github.com/pedra-ai/pedra-mcp/releases) and double-click it (or drag it into Claude Desktop → Settings → Extensions). Claude installs the bundled server and prompts for your `PEDRA_API_KEY` — no JSON editing.

### Claude Desktop (manual)

Or add this to your `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "pedra": {
      "command": "npx",
      "args": ["-y", "@pedra-ai/mcp"],
      "env": { "PEDRA_API_KEY": "your-api-key" }
    }
  }
}
```

### Cursor

In `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "pedra": {
      "command": "npx",
      "args": ["-y", "@pedra-ai/mcp"],
      "env": { "PEDRA_API_KEY": "your-api-key" }
    }
  }
}
```

### Any MCP client

Run the binary directly with the key in the environment:

```bash
PEDRA_API_KEY=your-api-key npx -y @pedra-ai/mcp
```

Or install it:

```bash
npm install -g @pedra-ai/mcp
PEDRA_API_KEY=your-api-key pedra-mcp
```

### Smithery

You can also install and configure Pedra automatically via [Smithery](https://smithery.ai/server/@pedra-ai/mcp):

```bash
npx -y @smithery/cli install @pedra-ai/mcp --client claude
```

(swap `claude` for `cursor`, `windsurf`, etc.) Smithery prompts for your `PEDRA_API_KEY` and writes the client config for you.

## Tools

| Tool | Endpoint | What it does |
|------|----------|--------------|
| `pedra_enhance` | `/enhance` | Improve lighting, color, sharpness |
| `pedra_enhance_and_correct_perspective` | `/enhance_and_correct_perspective` | Enhance + straighten perspective |
| `pedra_empty_room` | `/empty_room` | Remove all furniture/objects |
| `pedra_furnish` | `/furnish` | Virtually stage a room |
| `pedra_renovation` | `/renovation` | Renovate walls/floors/finishes |
| `pedra_edit_via_prompt` | `/edit_via_prompt` | Edit from a natural-language prompt |
| `pedra_sky_blue` | `/sky_blue` | Replace a dull sky with clear blue |
| `pedra_remove_object` | `/remove_object` | Remove an object using a mask |
| `pedra_blur` | `/blur` | Blur faces, license plates, etc. |
| `pedra_create_video` | `/create_video` | Render a property video from images |
| `pedra_credits` | `/credits` | Read plan + remaining credits |
| `pedra_feedback` | `/feedback` | Thumbs up/down + optional credit-back |

Most image tools take an `imageUrl` plus a few optional parameters; see each tool's input schema in your MCP client. The `imageUrl` (and `maskUrl`, and each `create_video` frame) accepts any of:

- a public `https://` URL,
- a `data:` URI, or
- an **absolute path to a local image file** — the server reads it off disk and inlines it as base64 for you, so you can point a tool at a file you just dragged in without hosting it first (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp`, `.tif/.tiff`, `.heic/.heif`, `.avif`; up to 40 MB).

> Note: an image **pasted into the chat** is not a file path, so it can't be forwarded to the tool — drag in a file, or save the paste and pass its path.

Example prompts once connected:

> "Use Pedra to virtually stage https://example.com/empty-living-room.jpg as a minimalist living room."

> "Virtually stage /Users/me/Desktop/empty-living-room.jpg as a minimalist living room."

> "How many Pedra credits do I have left?"

## How it works

This server is a thin wrapper over [`@pedra-ai/sdk`](https://www.npmjs.com/package/@pedra-ai/sdk), which encodes the API's contract details:

- **Synchronous by design.** Every endpoint blocks and returns the final URL(s) in the response body. Even `pedra_create_video` polls server-side and returns the finished `videoUrl` inline (it can take up to ~10 minutes; the API keeps the connection alive with a heartbeat).
- **Errors are tool errors.** The API's 4xx responses (insufficient credits, bad image, …) come back as MCP tool errors with a readable message, not crashes.

## Privacy Policy

This server sends the image/video URLs and parameters you pass to the [Pedra API](https://pedra.ai) to perform the requested edit, authenticated with your `PEDRA_API_KEY`. It stores no data itself. Data collection, usage, storage, retention, third-party sharing, and contact information are covered by Pedra's privacy policy: **https://pedra.ai/privacy**.

## License

MIT © Pedra
