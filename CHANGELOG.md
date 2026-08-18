# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.7.1] - 2026-08-19

### Changed

- README, PLAN, and `--help` lead with “How do I make this API agent-sized?”
  `curate` is the headline command; conversion is supporting. Every generate
  still prints the definition token footprint.

### Added

- **`--deferred`** — MCP search-then-load: expose `search_tools`, `get_tool_schema`, and `invoke_tool` instead of every operation. Supported on `mcp-tool-defs`, `mcp-ts-server`, `mcp-python-server`, and the plugin scaffolds. Use when the surface is still large after (or instead of) curation.
- **Description budgets** on curation presets: `minimal` 80 chars, `standard` 200, `full` unlimited.
- **Context-cost on every generate** — `this surface costs ~N tokens of definitions`. Human mode prints it; `--json` keeps the artifact on stdout and the cost line on stderr. Library `summary.definitionTokens` / `sourceToolCount` / `heaviest`.

## [0.7.0] - 2026-08-18

### Added

- **`ruah conv curate`** — IR→IR curation: group endpoint families into task tools (`managePets` with an `action` enum), emit a replayable `curation.json`, report definition token cost, and optionally generate from the curated surface
- **Presets** — `--preset minimal|standard|full` (default `standard`, ≤10 task tools). `--limit` overrides the cap
- **Replay + drift** — `curate --plan curation.json` and `generate --plan curation.json` re-apply saved accept/split/drop decisions and report added/removed endpoints
- **`--interactive`** — TTY walk of each family (`accept` / `split` / `drop`)
- **`--curate` on generate** — apply default curation before any target
- Public library: `proposeCurate`, `applyCurate`, `replayPlan`, `estimateTokens`

### Changed

- Curate is no longer rank-and-slice. Collection + item CRUD collapse into one tool; `/v1` and `/v2` never merge; every drop has a stated reason

## [0.6.0] - 2026-05-21

### Added

- **Per-operation auth selection** — generated `applyAuth` (TS) and `apply_auth` (Python) now take an `operationAuth: ReadonlyArray<string>` argument and only apply schemes that the operation actually requires (from the spec's `operation.security`, falling back to a `DEFAULT_AUTH_SCHEMES` constant when the operation has no explicit security). First scheme to set `Authorization` wins — multi-scheme specs like Stripe (basic + bearer) no longer double-stamp the header. Other headers (e.g. `X-API-Key`) are still set independently
- **Structured `_meta.ruah` on tool definitions** — every tool emitted by `mcp-tool-defs`, `openai-tools` (under `function._meta`), `anthropic-tools`, and the registered MCP servers carries `{ risk, method, path, pagination?, auth?, deprecated? }` in MCP's reserved `_meta` slot. Downstream policy engines, Guard, and `jq` pipelines can read structured metadata instead of grepping descriptions
- **`.env.example`** generated alongside `mcp-ts-server`, `mcp-python-server`, `a2a-wrapper`, and the plugin scaffolds — lists every auth scheme with its type and env-var name, so users see what they need to set
- **`--verbose` CLI flag** on `generate` — shows the full validation-warning list. Default behavior is now a one-line summary grouped by warning code (top 5 codes, descending; e.g. `⚠ 421 warnings: 380 missing-param-description, 32 missing-response-schema, 9 unresolved-ref`). `ruah conv validate` still prints every warning unchanged
- `ToolDefinition` and `ToolDefinitionMeta` types exported from `@ruah-dev/conv-core` for downstream consumers
- `summarizeWarnings(warnings)` helper exported from `ir/validate.ts`

### Changed

- `enrichToolDescription` joins parts with `\n\n` (was `" "`) and uses full-sentence suffixes ("Risk: destructive — this operation modifies or removes state.") so descriptions read cleanly regardless of source punctuation. The risk hint is still in the description text for clients that don't read `_meta`

## [0.5.1] - 2026-05-21

### Fixed

- **OpenAPI/Swagger `$ref` parameters** — `convertParameter` and `mergeParameters` treated raw `{$ref: "..."}` objects as already-resolved, producing parameters with empty `name`/`in` and colliding all refs in an operation onto a single empty-string slot. GitHub's spec hit this hundreds of times via its pagination refs (`pagination-before`, `pagination-after`, `direction`). The OpenAPI parser now resolves `#/components/parameters/<name>` (with cycle detection); the Swagger 2.0 parser lifts reusable parameters into `components.parameters` and rewrites `#/parameters/<name>` refs so the same resolver handles both. Unresolvable refs surface as `unresolved-ref` validation warnings and are dropped instead of silently emitting empty-name parameters
- **Request body encoding for non-JSON content types** — generated `mcp-ts-server`, `mcp-python-server`, and `a2a-wrapper` scaffolds previously emitted `String(payload)` when `flattenedBody` was true and the content type wasn't JSON, producing the literal text `"[object Object]"` as the HTTP body. Every Stripe POST (and any `application/x-www-form-urlencoded` API) failed at runtime. Generators now encode per content type: JSON (including `application/vnd.api+json` variants) via `JSON.stringify`, `application/x-www-form-urlencoded` via `URLSearchParams` with Stripe-style one-level bracket nesting (`metadata[order_id]=foo`), `multipart/form-data` via `FormData` (TS) / `httpx files=` (Python) with the runtime setting `Content-Type` and boundary, unknown types fall back to JSON with a runtime warning. `plugin-ts` inherits the fix transparently

### Changed

- README "What's Shipped" and "Not Yet" sections make the v0.5 scope auditable (concrete capability bullets; explicit gaps for per-operation auth selection, runtime pagination wrappers, retry, dry-run). Roadmap section now lists v0.4, v0.5, and v0.6 (planned)

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
