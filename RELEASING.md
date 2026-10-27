# Releasing

Releases are cut by hand from a clean `main` with
[release-it](https://github.com/release-it/release-it), wrapped by
`scripts/release.mjs`. One command bumps the version, moves the changelog's
Unreleased section into the new version, commits, tags `vX.Y.Z`, pushes,
creates the GitHub Release, and then publishes `@crcatala/oura-cli` to npm from
the tagged commit.

Publishing comes last so the published build is stamped with the release
commit and a clean tree: `oura --version` prints `oura X.Y.Z (sha7 YYYY-MM-DD)`
from `dist/build-info.json`, which `npm run build` writes. release-it's own npm
step is turned off in `.release-it.json` because it would publish before the
commit and tag exist.

## Prerequisites

- Push access to `crcatala/oura-cli`.
- A GitHub token available as `GITHUB_TOKEN` with repository **Contents: read and write**
  permission, so release-it can create the GitHub Release (without it, release-it opens
  the GitHub release form in the browser instead).
- An npm login with publish rights to the `@crcatala` scope: `npm whoami`, else `npm login`.
- Node.js `^22.21.0 || >=24.0.0` (the release-it v21 requirement).

The package is public (`publishConfig.access` in `package.json`) and installs the `oura`
and `oura-cli` commands.

## Before releasing

1. Start from an up-to-date `main`:

   ```bash
   git checkout main
   git pull --ff-only
   ```

2. Draft the changelog:

   ```bash
   npm run release:prep
   ```

   Paste the output into an LLM, review the result, and put it under
   `## [Unreleased]` in `CHANGELOG.md` ([Keep a Changelog] groups: Added, Changed,
   Fixed, Removed, Security; user-facing changes only). Commit it to `main` and push.

## Release

```bash
npm run release:dry       # preview; changes nothing and skips the hooks
npm run release           # asks for the version; or: npm run release -- patch|minor|major
```

In order, `npm run release`:

1. refuses to start when not logged in to npm or when `HEAD` is already a release;
2. checks that Unreleased has entries and runs `npm run verify` (build, tests, lint,
   typecheck, package smoke test);
3. bumps the version and the changelog, then runs `npm run test:package` (packs the
   tarball, installs it with production dependencies, checks `--help` and the
   `--version` format for `oura` and `oura-cli`, plus the checks in
   `scripts/test-package.local.sh`);
4. commits `chore: release vX.Y.Z`, tags `vX.Y.Z`, pushes both;
5. creates the GitHub Release from the changelog section;
6. publishes to npm from the tagged commit (npm may ask for a one-time password;
   `prepublishOnly` runs `npm run verify` once more).

Other forms:

```bash
npm run release -- 0.6.1                 # a specific version, no prompt
npm run release -- --preRelease=alpha    # a prerelease
```

## When a step fails

- **Before the commit** (steps 1–3): nothing was changed on the remote. Fix the
  cause and run `npm run release` again; `git checkout -- .` discards a
  half-made bump.
- **GitHub Release** (step 5): the tag is pushed. Create the release from the
  tag with that version's CHANGELOG section as notes
  (`gh release create vX.Y.Z --title vX.Y.Z --notes-file <section>`), then run
  `npm run release:publish`.
- **npm publish** (step 6): the tag is pushed; only the publish is left. Run
  `npm run release:publish` from the tagged commit.

## Verify

```bash
npm view @crcatala/oura-cli version
npx -y @crcatala/oura-cli@latest --version     # oura X.Y.Z (sha7 YYYY-MM-DD)
npx -y @crcatala/oura-cli@latest --help
```

Published npm versions are immutable. If a release has a defect, publish a corrective
version rather than replacing the existing version.

## Release scripts

`scripts/prep-release.sh`, `scripts/check-changelog.sh`, `scripts/test-package.sh`,
`scripts/release.mjs` and `scripts/build-info.mjs` are shared copies from the release
standard (each starts with a `release-standard:` header); do not edit them here.
Project-specific package checks go in `scripts/test-package.local.sh`.

[Keep a Changelog]: https://keepachangelog.com/en/1.1.0/
