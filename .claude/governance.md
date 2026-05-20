# Governance — @ruah-dev/conv
# This file is the single source of truth for project rules.
# Universal pre-start / post-start skills read this and adapt.
# Change this when standards change. Skills never go stale.

## Identity
- Project: @ruah-dev/conv
- Version: 0.4.0 (published on npm)
- Description: TypeScript CLI that converts API specs (OpenAPI 3.0/3.1, Swagger 2.0, Postman v2.1, GraphQL SDL) into agent-ready tool surfaces (MCP TS/Python servers, OpenAI/Anthropic tool defs, A2A wrapper, Claude Code/Codex plugin scaffolds).
- Structure: npm workspaces. Outer package wraps `packages/core` (the real code). Outer `bin/ruah-conv.js` shells to `packages/core/dist/cli.js`.
- Runtime: Node >= 18, ESM, TypeScript strict.

## Gates (run in order, stop on failure)
These are the canonical gates. Do not invent new ones. Match `prepublishOnly`.

1. `npm run typecheck`  — TypeScript strict check across workspaces
2. `npm run lint`       — Biome check (root + packages/core)
3. `npm test`           — `node --test test/*.test.mjs` + `npm run test --prefix packages/core`
4. `npm run build`      — emits to `packages/core/dist`

All four must pass before commit. `prepublishOnly` re-runs all four — never bypass with `--no-publish-check`.

## Scaffold-Output Integrity Rule
Every generator target in `packages/core/src/generators/` MUST write its emitted files to disk via the CLI's `--output` path. There is a regression test for this in `packages/core/test/generator.test.ts` — keep it green. When adding a new generator target:
- The target's `generate()` must return file entries the CLI then writes to `--output`.
- A test must assert the expected files appear on disk after running the CLI with `--output`.
- Do not return content-only without writing — that's the regression.

## Branch & Commit
- Trunk-based on `main`.
- Conventional Commits. Scope is `conv` for code changes; `docs:` / `chore:` for non-code.
  - Examples (from `git log`): `feat(conv): add Claude Code and Codex plugin targets`, `fix(conv): repair release workflow inputs`, `chore(conv): bump version to 0.1.1`.
- Trailer required:
  ```
  Co-Authored-By: Claude <noreply@anthropic.com>
  ```
- Never `git push --no-verify`. Never `git commit --no-verify`.

## Security
- Auth: none (CLI tool, no runtime auth surface).
- No secrets in repo. Grep before commit:
  - `sk_live`, `sk_test`, `AKIA`, `password=`, `BEGIN RSA PRIVATE`, `BEGIN OPENSSH`, `npm_`, `gh[pousr]_`
- No `.env*` files committed.
- The `postinstall.mjs` script runs on user installs — review changes to it carefully (supply-chain surface).

## Out-of-Bounds (do not touch without explicit user instruction)
- `packages/core/src/**` — source code
- `packages/core/test/**` — tests
- `packages/core/dist/**`, `dist-test/**` — build output
- `README.md` — already exists; do not regenerate
- `npm publish` — never run; release is via the workflow

## Autonomy
- Auto-run all four gates before any commit.
- Ask before committing — this is a published library, mid-maturity tier.
- Never push to `main` without explicit user instruction.

## Deployment
- Distribution: npm registry (`@ruah-dev/conv`, public).
- Release: GitHub Actions workflow (`.github/workflows/*`). Do not run `npm publish` locally.

## Conventions
- ESM everywhere. No CommonJS in new code.
- TypeScript strict; no `any` without an inline justification comment.
- Biome for both lint and format — do not add ESLint or Prettier.
- Tests use `node --test` only — do not add Vitest/Jest.
- No bundler (tsc only). Do not add esbuild/rollup/tsup.
