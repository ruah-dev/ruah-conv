# Releasing `@ruah-dev/conv`

The release pipeline is **tag-driven**. CI handles npm publishing and the GitHub release; the human bumps version files, opens a PR, and pushes a tag.

## 1. Bump versions locally

Run the helper script. It updates every place a version lives so they cannot drift:

```bash
npm run prepare-release -- --version vX.Y.Z
```

This edits:

- `package.json` (root) — `version`
- `packages/core/package.json` — `version`
- `.claude/governance.md` — the `Version: X.Y.Z` line
- `CHANGELOG.md` — inserts a stub `## [X.Y.Z] - YYYY-MM-DD` section above `[Unreleased]`

Open `CHANGELOG.md` and move the entries from `[Unreleased]` into the new section. Fill in `### Added` / `### Fixed` / `### Changed` as needed.

## 2. Open a release PR

```bash
git checkout -b release/vX.Y.Z
git add -A
git commit -m "release(conv): vX.Y.Z"
git push -u origin release/vX.Y.Z
```

Open a PR against `main`. CI runs:

- **PR Check** / **Governance Gates** — typecheck, lint, test
- **Bin Smoke** — `bin/ruah-conv.js --version`, `targets --json`, `generate` end-to-end on Node 18/20/22
- **Version Sync** — fails if `package.json` and `.claude/governance.md` disagree

All must be green before merge.

## 3. Tag and push

After the PR merges:

```bash
git checkout main && git pull
git tag vX.Y.Z
git push origin vX.Y.Z
```

## 4. CI takes over

The [`release.yml`](./workflows/release.yml) workflow:

1. Runs typecheck + lint + tests
2. Builds and publishes `@ruah-dev/conv-core` with `--provenance`
3. Waits (up to ~5 min) until that version is visible on the npm registry
4. Rewrites the root manifest's `@ruah-dev/conv-core` dependency from `file:` to the published version
5. Publishes `@ruah-dev/conv` with `--provenance`
6. Creates a GitHub Release with auto-generated notes

A pre-release tag like `v0.5.0-beta.1` is published to the matching dist-tag (`beta`) and marked as a GitHub pre-release. A plain `vX.Y.Z` tag goes to `latest`.

## Hot-fixing a broken release

Do **not** retry the same tag — npm and GitHub will both reject it. Bump the patch (e.g., `v0.4.1`), re-run `prepare-release`, and start over from step 1.
