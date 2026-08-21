# Release

For `@shuind/dsh-codex-harness`.

## Publish

Run from the repository directory:

```powershell
npm whoami
npm version <version> --no-git-tag-version
pnpm run check
pnpm test
pnpm run build
pnpm pack --dry-run
git add package.json
git commit -m "release: publish v<version>"
git tag v<version>
git push origin main --tags
npm publish --access public
npm view @shuind/dsh-codex-harness@<version> version
```

`npm publish` runs the package build through `prepare`. Publish only after the
dry-run contains the current `lib/` files and `presets/codex/`.

## Authentication

An npm token may remain configured for future releases:

```powershell
npm config set "//registry.npmjs.org/:_authToken" "<TOKEN>"
```

Do not commit or paste the token. If npm requests two-factor authentication,
publish with `--otp=<code>` or use a token authorized to publish this package.

Token cleanup is optional; if the token is removed, run `npm login` or configure
another token before the next release.
