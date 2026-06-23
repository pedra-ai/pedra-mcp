# Publishing `@pedra-ai/mcp` to npm

The package is published as a **public scoped** package (`@pedra-ai/mcp`).
`publishConfig.access` is already `public`, so a plain `npm publish` works.

## One-time setup

The `pedra-ai` npm org already exists (created for `@pedra-ai/sdk`). You need a
member with publish rights. Because the account has 2FA enabled, publishing from
the CLI requires a **Classic Automation token** (a Publish token still prompts
for an OTP). Create one at
https://www.npmjs.com/settings/<user>/tokens → Generate New Token → Classic →
**Automation**, then either `npm login` or publish with the token:

```bash
echo "//registry.npmjs.org/:_authToken=npm_xxx" > ~/.npmrc   # or use NPM_TOKEN in CI
```

## Publish

```bash
npm install        # deps + dev deps
npm test           # builds + runs the test suite
npm publish        # builds via prepublishOnly, publishes @pedra-ai/mcp@<version>
```

`prepublishOnly` runs `clean` + `build`, so `dist/` is always fresh. Only
`dist/`, `README.md`, and `LICENSE` ship in the tarball (see `.npmignore`);
verify with `npm pack --dry-run`.

## Releasing a new version

```bash
npm version patch   # or minor / major — bumps package.json + git tag
git push --follow-tags
npm publish
```

Update `CHANGELOG.md` before tagging.

## CI

`.github/workflows/ci.yml` runs `npm test` on Node 18/20/22 for every push and
PR. Consider adding a publish job gated on git tags + an `NPM_TOKEN` secret
(reuse the Automation token).
