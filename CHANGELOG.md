# Changelog

All notable changes to this project will be documented in this file.

## [0.4.0] - 2026-05-15

### Added

- `--operation-profile` flag with `read-only`, `standard`, and `all` presets, an interactive prompt when running OpenAPI specs in a TTY, and matching `operationProfile` support in `ruah.conv.json`

### Fixed

- `generate --output <dir>` now creates nested parent directories, unblocking the `mcp-ts-server`, `a2a-wrapper`, `claude-code-plugin-ts`, and `codex-plugin-ts` targets that previously crashed with `ENOENT`
- Generated TypeScript MCP server / Claude Code / Codex plugin scaffolds now typecheck cleanly under `strict: true` — `OPERATIONS` is typed via an explicit `Operation` interface (no more `as const` over-narrowing), `invokeOperation` returns `Promise<CallToolResult>`, and content blocks use `type: "text" as const`
- `generate --json` now errors with a clear message when used on multi-file scaffold targets instead of silently emitting only the first file

## [0.3.0] - 2026-04-14

### Added

- Claude Code plugin scaffold generator with `.claude-plugin/plugin.json` and `.mcp.json`
- Codex plugin scaffold generator with `.codex-plugin/plugin.json` and `.mcp.json`

### Changed

- Updated the README and CLI docs to document the new plugin bundle targets

## [0.2.0] - 2026-04-11

### Added

- Swagger 2.0 auto-upgrade into the shared Ruah Tool Schema IR
- Postman v2.1 collection parser
- GraphQL SDL parser
- MCP TypeScript server scaffold generator
- MCP Python FastMCP server scaffold generator
- OpenAI and Anthropic tool schema generators
- A2A wrapper scaffold generator
- Config file support via `ruah.conv.json`, `.ruah-conv.json`, and `ruah.conv.config.json`
- Pagination detection metadata for common offset/page/cursor patterns
- Standalone `ruah-conv` bin entry for the published package
- Expanded automated validation for generated TS, Python, and A2A scaffolds

### Changed

- Updated the README and CLI docs to reflect the shipped v0.2 surface
- Hardened the generated MCP TS/A2A scaffolds around auth, request bodies, and HTTP transport wiring
- Reworked GitHub Actions so release CI validates both the root package and `packages/core`
- Updated tag-based release automation to publish `@ruah-dev/conv-core` before `@ruah-dev/conv`
- Increased automated coverage from 47 to 60 passing tests

### Removed

- Removed the Reddit launch draft from the repository

## [0.1.0] - 2026-04-10

### Added

- OpenAPI 3.0 / 3.1 parser (local file, JSON + YAML)
- Ruah Tool Schema intermediate representation (IR)
- IR validation with 8 warning codes
- MCP tool definitions generator (JSON output)
- Tool naming policy: operationId normalization, path synthesis, deduplication
- Risk classification per tool (safe, moderate, destructive)
- CLI commands: `generate`, `inspect`, `validate`, `targets`
- `--json` flag on all commands for composition
- Programmatic API via `@ruah-dev/conv` imports
- Plug-and-play integration with `@ruah-dev/cli` via `ruah` field in package.json
- 47 tests using Node.js built-in test runner
- Petstore test fixture
