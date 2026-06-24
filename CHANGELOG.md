# Changelog

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
