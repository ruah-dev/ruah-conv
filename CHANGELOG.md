# Changelog

All notable changes to this project will be documented in this file.

## [0.5.0] - 2026-05-21

### Added

- HAR (HTTP Archive) parser — convert captured browser/proxy traffic into the IR; collapses URLs by path-template inference, extracts query params, infers JSON body schemas, and detects bearer / api-key auth from request headers
- Runtime auth wiring in generated `mcp-ts-server`, `mcp-python-server`, `a2a-wrapper`, `claude-code-plugin-ts`, and `codex-plugin-ts` scaffolds — env-var-based injection of `API_KEY`, `BEARER_TOKEN`, `BASIC_AUTH_USER`/`PASS`, and `OAUTH_TOKEN` (suffixed with scheme id when multiple schemes of the same kind exist); missing env vars warn but never crash. Opt out with `--no-auth-wiring` or `authWiring: false` in config
- `GeneratorCapability` descriptors on every target plus CLI-level flag validation — `--transport`, `--json`, and `--name` now error with a clear message when the chosen target doesn't support them, instead of being silently ignored
- `defineSimpleGenerator()` factory unifying the trivial JSON-only targets (`openai-tools`, `anthropic-tools`, `mcp-tool-defs`)
- Plugin manifest config — `plugin.name`, `plugin.description`, `plugin.icon`, `plugin.hiddenTools`, and `plugin.author` in `ruah.conv.json` customize the generated Claude Code and Codex bundles
- Pagination overrides in `ruah.conv.json` — `pagination.defaults.{offsetParams,limitParams,cursorParams}` extend the heuristic, and `pagination.byOperation.<toolName>` overrides per operation
- `SpecParseError` (exported) wraps every parser failure with `{ path, format, cause }` for clearer CLI errors
- `unsupported-graphql-type` validation warning — GraphQL unions, interfaces, dangling refs, and unparseable fields surface instead of silently degrading to `any`
- Semantic-correctness assertions in `generator.test.ts` — required-flag, type/min/max/enum preservation, risk classification, pagination annotation, and scaffold tool-name coverage
- Integration smoke test — spawns a generated MCP TS server via stdio, exchanges `initialize` / `tools/list` / `tools/call`, asserts the server stays alive. Opt-in via `RUN_INTEGRATION=1 npm run test:integration` in `packages/core`
- `bin-smoke.yml` CI workflow — Node 18/20/22 matrix runs `--version`, `targets --json`, and a petstore `generate` to catch ESM/bin regressions
- `version-sync.yml` CI workflow — fails the build when `.claude/governance.md` drifts from the root `package.json` version
- `scripts/prepare-release.mjs` and `.github/RELEASING.md` — human-driven release helper that bumps root + core `package.json`, syncs `governance.md`, and adds a dated CHANGELOG header
- `postinstall.mjs` refactored into pure functions (`resolveCliEntrypoint`, `chooseLauncherPath`, `buildUnixLauncherScript`, `buildWindowsLauncherScript`) covered by 14 cross-platform unit tests
- `writeGeneratedFiles()` shared helper centralizing nested-dir creation and writes for every generator

### Changed

- Trivial generators (`openai-tools`, `anthropic-tools`, `mcp-tool-defs`) refactored onto the shared factory; behavior unchanged

### Security

- **Python identifier injection (critical)** — added `toSafePythonIdent()` sanitizer applied to every IR string interpolated as a Python identifier (function names, parameter names). Blocks a path where a malicious HAR body key (e.g. `x):\n    import os ...`) could become top-level Python code at generated-server boot
- **Path traversal in scaffold emission (high)** — `writeGeneratedFiles()` now refuses to write outside the resolved output directory (`path.relative` + `..` prefix check)
- **Unencoded path params in Python scaffolds (medium)** — generated `mcp-python-server` now imports `urllib.parse.quote` and URL-encodes path-parameter interpolations with `safe=""`, matching the TS generator's `encodeURIComponent` behavior

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
