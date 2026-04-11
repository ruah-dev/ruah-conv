# Changelog

All notable changes to this project will be documented in this file.

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
- Stronger artifact validation for generated TypeScript, Python, and A2A outputs

### Changed

- Updated the README and CLI docs to reflect the shipped v0.2 surface
- Hardened the generated MCP TS/A2A scaffolds around auth, request bodies, and HTTP transport wiring
- Increased automated coverage from 47 to 60 passing tests

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
