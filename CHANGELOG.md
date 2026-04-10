# Changelog

All notable changes to this project will be documented in this file.

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
