# Changelog

## 0.2.1

- Add a bundle `icon.png` (512×512) and reference it from `manifest.json` so the
  server displays with the Pedra logo in Claude Desktop and the Anthropic MCP
  directory. Also ship the icon in the npm tarball (`files`) for registries that
  ingest the icon from npm. No runtime/tool changes.

## 0.2.0

- Image inputs now accept a **local file path**, not just a URL or `data:` URI.
  When `imageUrl`/`maskUrl` (and each `create_video` frame) is a local path, the
  server reads the file and inlines it as a base64 `data:` URI before calling the
  API — so you can point a tool at a file you dragged in without hosting it first.
  Handles `file://`, `~`, and quoted/space-escaped paths; supports common image
  types up to 40 MB; unsupported types and unreadable files surface as clear tool
  errors. (Pasting an image into the chat is unchanged — that's not a file path,
  so pass a path or URL.)

## 0.1.2

- Add behavioral annotations to every tool (`readOnlyHint`/`destructiveHint`/
  `openWorldHint` + `title`) — `pedra_credits` is read-only; the rest create
  new assets and are non-destructive. Required for the Claude connectors
  directory.
- Add `manifest.json` + `.mcpbignore` so the server can be packaged as a Claude
  Desktop Extension (`.mcpb`) — self-contained bundle, one-click install,
  `PEDRA_API_KEY` collected via `user_config`.
- README: Privacy Policy section + one-click `.mcpb` install instructions.

## 0.1.1

- Add MCP registry artifacts: `server.json` (official registry manifest) and
  `smithery.yaml` (Smithery stdio config).
- Add `mcpName` (`io.github.pedra-ai/pedra-mcp`) to `package.json` to prove npm
  package ownership to the official registry.
- Add `.github/workflows/release.yml`: a tagged release now publishes to npm
  (with provenance) and to the official MCP registry via GitHub OIDC.
- No runtime/tool changes.

## 0.1.0

- Initial release.
- MCP server exposing one tool per Pedra API endpoint: `pedra_enhance`,
  `pedra_enhance_and_correct_perspective`, `pedra_empty_room`, `pedra_furnish`,
  `pedra_renovation`, `pedra_edit_via_prompt`, `pedra_sky_blue`,
  `pedra_remove_object`, `pedra_blur`, `pedra_create_video`, `pedra_credits`,
  `pedra_feedback`.
- Thin wrapper over [`@pedra-ai/sdk`](https://www.npmjs.com/package/@pedra-ai/sdk):
  each tool is a single blocking call that returns the final asset URL(s).
- API key via the `PEDRA_API_KEY` environment variable; the API's 4xx errors
  (insufficient credits, bad image, …) surface as MCP tool errors.
- stdio transport; runs via `npx -y @pedra-ai/mcp`.
