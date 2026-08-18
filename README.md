# ruah conv

[![npm version](https://img.shields.io/npm/v/@ruah-dev/conv)](https://www.npmjs.com/package/@ruah-dev/conv)
[![license](https://img.shields.io/npm/l/@ruah-dev/conv)](LICENSE)
[![tests](https://img.shields.io/badge/tests-196%20passing-brightgreen)](test/)

**Convert API specs into agent-ready tool surfaces.**

Feed it an OpenAPI spec, get MCP tool definitions, function-calling schemas, host-ready plugin bundles, or a full MCP server scaffold. One intermediate representation in the middle — every input parser normalizes to it, every output generator reads from it.

```
 Input Parsers              IR                    Output Generators
 ─────────────        ──────────────            ─────────────────────
 OpenAPI 3.x  ──┐                            ┌── MCP Tool Definitions ✓
 Swagger 2.0  ──┤                            ├── MCP Server (TS) ✓
 Postman v2.1 ──┼──→  Ruah Tool Schema  ───┼── MCP Server (Python) ✓
 GraphQL SDL  ──┤     (canonical IR)         ├── Function Calling (OpenAI) ✓
 HAR captures ──┘                            ├── Function Calling (Anthropic) ✓
                                             ├── Claude Code plugin bundle ✓
                                             ├── Codex plugin bundle ✓
                                             └── A2A service wrapper ✓
```

**Now shipped:** OpenAPI 3.x, Swagger 2.0, Postman v2.1, GraphQL SDL, and HAR capture inputs; MCP JSON defs; MCP TypeScript/Python scaffolds; OpenAI and Anthropic tool schemas; Claude Code and Codex plugin scaffolds; A2A wrapper scaffold; config-file support.

## What's Shipped

Concrete capabilities you can verify against the current release:

- **Risk classification** — every tool gets `safe`, `moderate`, or `destructive` based on HTTP method
- **Operation profiles** — `read-only`, `standard`, and `all` presets for OpenAPI/Swagger inputs
- **Multi-format input** — OpenAPI 3.0/3.1, Swagger 2.0, Postman v2.1, GraphQL SDL, HAR captures
- **Multi-target output** — TypeScript and Python MCP servers, Claude Code and Codex plugin scaffolds, OpenAI and Anthropic tool definitions, A2A wrapper
- **Auth scaffolding** — `securitySchemes` from the spec are extracted into the IR and wired into generated scaffolds via env vars (header, query, bearer, basic, oauth2 placeholder)
- **Pagination detection** — common patterns (`limit`/`offset`, page-number/page-size, cursor) are detected and annotated in tool descriptions
- **Clean TypeScript output** — generated scaffolds compile against real-world specs (Stripe, GitHub) without manual fix-up
- **Single runtime dependency** — `yaml` only
- **Curation** — `ruah conv curate` collapses a hostile 400-endpoint spec into ≤10 task-shaped tools (`managePets` with an `action` enum), prints definition token cost, and writes a replayable `curation.json`

## Not Yet

Honest about the gaps so you know what to build on top:

- **Per-operation auth selection** — the IR extracts `securitySchemes` and the generator wires env-var-based injection, but `operation.security` is not yet honored. Generated `applyAuth` attempts every declared scheme on every request. Planned for v0.6.
- **Pagination runtime wrapper** — pagination is detected and annotated, but generated scaffolds do not auto-page. Consumers handle the next-page call themselves.
- **Retry / backoff** — not generated. Wrap calls with your own retry policy.
- **Dry-run mode** — no `--dry-run` flag. Generation always writes (or emits to stdout when `--output` is omitted).

## See It

<p align="center">
  <img src="https://ruah.sh/demos/ruah-conv-demo.gif" alt="ruah-conv — inspect, validate, and generate MCP tool definitions from API specs" width="100%" />
</p>

```bash
# Parse a spec and see what's inside
npx @ruah-dev/conv inspect petstore.yaml
```

```
API Spec Summary
──────────────────────────────────────────────────
  Title:    Petstore API
  Version:  1.0.0
  Format:   openapi-3.0
  Base URL: https://api.petstore.example.com/v1

Auth Schemes (1)
  • apiKeyAuth: apiKey (X-API-Key)

Tools (4)
  • listPets    GET    /pets           (2 params)
  • createPet   POST   /pets           (0 params +body)  [moderate]
  • getPet      GET    /pets/{petId}   (1 params)
  • deletePet   DELETE /pets/{petId}   (1 params)         [destructive]

Types (3)
  Pet, NewPet, Error
```

```bash
# Collapse a spec into task tools, then generate
npx @ruah-dev/conv curate petstore.yaml
npx @ruah-dev/conv generate petstore.yaml --curate --json
```

```
# ruah-conv curate — Petstore API
this surface costs ~174 tokens of definitions (4 tools)
curated set: 1 tools, ~29 tokens  [standard]

  keep   managePets             4 ops  /pets
         list       GET    /pets
         get        GET    /pets/{petId}
         create     POST   /pets
         delete     DELETE /pets/{petId}
```

```bash
# Generate MCP tool definitions
npx @ruah-dev/conv generate petstore.yaml --json
```

```json
[
  {
    "name": "listPets",
    "description": "List all pets",
    "inputSchema": {
      "type": "object",
      "properties": {
        "limit": { "type": "integer", "minimum": 1, "maximum": 100 },
        "offset": { "type": "integer" }
      }
    }
  },
  {
    "name": "createPet",
    "description": "Create a new pet",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "tag": { "type": "string" }
      },
      "required": ["name"]
    }
  }
]
```

## Use It

```bash
# Curate: group families, write a replayable plan
ruah conv curate ./spec.yaml --out ./curated --preset standard
ruah conv generate ./spec.yaml --plan ./curated/curation.json --target mcp-tool-defs --json

# Generate MCP tool definitions (JSON)
ruah conv generate ./spec.yaml --target mcp-tool-defs --json

# Generate OpenAI tool/function schemas
ruah conv generate ./spec.yaml --target openai-tools --json

# Generate a TypeScript MCP server scaffold
ruah conv generate ./spec.yaml --target mcp-ts-server --output ./generated-server

# Force a safer or broader OpenAPI/Swagger operation preset
ruah conv generate ./spec.yaml --operation-profile read-only
ruah conv generate ./spec.yaml --operation-profile all

# Generate a Claude Code plugin bundle
ruah conv generate ./spec.yaml --target claude-code-plugin-ts --output ./generated-claude-plugin

# Generate a Codex plugin bundle
ruah conv generate ./spec.yaml --target codex-plugin-ts --output ./generated-codex-plugin

# Write output to a directory
ruah conv generate ./spec.yaml --output ./generated/

# Inspect a spec — see tools, types, auth at a glance
ruah conv inspect ./spec.yaml

# Validate a spec — check for issues before generating
ruah conv validate ./spec.yaml

# Full IR as JSON — for piping into other tools
ruah conv inspect ./spec.yaml --json

# List available output targets
ruah conv targets
```

Or use the standalone CLI directly:

```bash
npx @ruah-dev/conv generate ./spec.yaml --json
```

## Curation heuristics (honest)

`ruah conv curate` is deterministic. It is not an LLM. Defaults (`--preset standard`):

| Rule | Effect |
|------|--------|
| Collection + item CRUD on the same resource | Merge into `manage{Resource}` with `action: list\|get\|create\|…` |
| `/v1/users` vs `/v2/users` | Never merge — version is part of the family id |
| `/users/{id}/orders` | Own family (`users/orders`), not folded into `manageUsers` |
| Deprecated operations | Dropped with reason `deprecated` |
| Rank | GET collection (10) > GET item (8) > POST collection (7) > writes (5) > DELETE (4). Deep paths and wide parameter lists lose a point |
| Budget | Keep the top 10 families (`minimal` = 5 read-only, `full` = no cap). Overflow is `over-budget`, not silent |

`--plan curation.json` replays your accept/split/drop decisions and prints drift when the spec gained or lost endpoints. `--interactive` walks each family on a TTY.

Token counts use the same chars/4 + word-boundary blend as `ruah-opt` (`// sync-with: ruah-opt/src/estimator.ts`). Expect ±20% vs a real tokenizer.

## How It Works

### 1. Parse

The parser reads OpenAPI 3.0/3.1, Swagger 2.0, Postman v2.1 collections, and GraphQL SDL, then normalizes everything into the **Ruah Tool Schema** — the canonical intermediate representation.

```bash
ruah conv inspect ./spec.yaml --json | jq '.tools | length'
# 12
```

### 2. Validate

The IR is validated for completeness. Warnings are advisory — the IR is always usable, but you'll know what's missing.

```bash
ruah conv validate ./spec.yaml
# ✓ Spec is valid — 12 tools, 8 types, no warnings.
```

| Warning | What it means |
|---------|--------------|
| `missing-description` | Tool has no description — LLMs need this |
| `missing-base-url` | No server URL — tools will need a runtime base URL |
| `duplicate-tool-name` | Two operations produced the same name |
| `unknown-type` | Schema couldn't be parsed — treated as `any` |
| `unresolved-ref` | `$ref` target not found in components |
| `no-operations` | Spec has no paths — nothing to convert |

### 3. Generate

The generator reads the IR and produces output for the target format.

For OpenAPI 3.x and Swagger 2.0 inputs, `generate` now asks which operation preset to expose unless you set `--operation-profile`, configure `operationProfile`, or run non-interactively. Non-interactive runs default to `standard`.

Current targets:
- `mcp-tool-defs` — JSON array of MCP-compatible tool definitions
- `mcp-ts-server` — TypeScript MCP server scaffold with stdio entrypoint and HTTP starter
- `mcp-python-server` — FastMCP Python server scaffold
- `openai-tools` — OpenAI tool/function definitions
- `anthropic-tools` — Anthropic tool definitions
- `claude-code-plugin-ts` — Claude Code plugin scaffold with a generated TypeScript MCP server
- `codex-plugin-ts` — Codex plugin scaffold with a generated TypeScript MCP server
- `a2a-wrapper` — A2A-style service wrapper scaffold

Each tool gets:
- **name** — normalized from `operationId` (or synthesized from method + path)
- **description** — from the spec's `summary` or `description`
- **inputSchema** — JSON Schema combining path params, query params, and request body

Paginated operations are detected heuristically and annotated in generated descriptions. Current patterns: `limit` + `offset`, page-number/page-size, and cursor-style query params.

OpenAPI/Swagger operation presets:
- `read-only` — includes `GET`, `HEAD`, `OPTIONS`
- `standard` — includes `read-only` plus `POST`, `PUT`
- `all` — includes `standard` plus `PATCH`, `DELETE`

### 4. Naming Policy

Operations become tool names using this priority:

1. Use `operationId` if present → `listPets`
2. Fall back to `method + path` → `getPetsPetId`
3. Deduplicate with numeric suffix → `listPets`, `listPets2`

Normalization: `get_user_by_id` → `getUserById`, `api.v2.list-pets` → `listPets`

### 5. Risk Classification

Every tool gets a risk level based on HTTP method:

| Method | Risk | Idempotent | Read-Only |
|--------|------|-----------|-----------|
| GET, HEAD, OPTIONS | `safe` | Yes | Yes |
| POST | `moderate` | No | No |
| PUT | `moderate` | Yes | No |
| PATCH | `destructive` | No | No |
| DELETE | `destructive` | Yes | No |

## Generated Auth Wiring

Scaffold targets (`mcp-ts-server`, `mcp-python-server`, `a2a-wrapper`, `claude-code-plugin-ts`, `codex-plugin-ts`) read the spec's `securitySchemes` and emit a schema-driven `applyAuth` that injects the correct headers or query parameters at request time. The generated code uses the header/query names declared in the spec — no manual edits required for the common cases.

Set these environment variables before launching the server:

| Scheme in spec | Env var(s) | What gets injected |
|---|---|---|
| `apiKey` (header) | `API_KEY` | Header named per spec (e.g. `X-API-Key`) |
| `apiKey` (query) | `API_KEY` | Query param named per spec |
| `http` / `bearer` | `BEARER_TOKEN` | `Authorization: Bearer <token>` |
| `http` / `basic` | `BASIC_AUTH_USER`, `BASIC_AUTH_PASS` | `Authorization: Basic <base64>` |
| `oauth2` (placeholder) | `OAUTH_TOKEN` | `Authorization: Bearer <token>` |

When a spec declares multiple schemes of the same kind, the env vars are suffixed with the scheme id (e.g. `API_KEY_PRIMARY`, `API_KEY_PARTNER`). Each generated scaffold prints the full env-var list as a top-of-file comment.

`oauth2` flows vary too widely to auto-generate; the scaffold accepts a pre-obtained bearer token via `OAUTH_TOKEN`. Acquire the token externally (client-credentials, device flow, etc.) and inject it.

Missing env vars never crash the server — `applyAuth` skips the header silently so endpoints that don't require auth still work. To opt out entirely and ship a no-op `applyAuth` stub, pass `--no-auth-wiring` to `ruah conv generate` or set `"authWiring": false` in `ruah.conv.json`.

## The IR: Ruah Tool Schema

The intermediate representation is the core of Convert. Everything normalizes to this, everything generates from this.

```typescript
interface RuahToolSchema {
  meta: SchemaMeta;       // title, version, baseUrl, source format
  auth: AuthSchema[];     // apiKey, http/bearer, oauth2
  tools: Tool[];          // one per API operation
  types: Record<string, TypeDefinition>;  // named schemas
}
```

The IR is inspectable: `ruah conv inspect ./spec.yaml --json` dumps the full IR. Useful for debugging, validating, and piping into other tools.

Adding a new input format = one parser that produces IR. Adding a new output format = one generator that consumes IR. Never N×M.

## Programmatic API

```typescript
import { parse, validateIR, generate } from "@ruah-dev/conv";

// Parse a spec
const ir = parse("./petstore.yaml");

// Validate
const warnings = validateIR(ir);

// Generate MCP tool definitions
const result = generate("mcp-tool-defs", ir);
console.log(result.files[0].content);
```

## CLI Reference

```
ruah conv generate <spec> [options]    Parse spec and generate output
  --target <id>                          Output target (default: mcp-tool-defs)
  --output <dir>                         Output directory (default: stdout)
  --name <value>                         Override generated server/service name
  --transport <mode>                     Generator transport hint
  --operation-profile <profile>          OpenAPI/Swagger preset: read-only, standard, all
  --config <path>                        Load generation defaults from JSON
  --no-auth-wiring                       Skip schema-driven auth wiring in scaffolds
  --json                                 Output as JSON

ruah conv inspect <spec> [options]     Parse spec and display IR summary
  --json                                 Output full IR as JSON

ruah conv validate <spec> [options]    Parse spec and report warnings
  --json                                 Output warnings as JSON

ruah conv targets [options]            List available output targets
  --json                                 Output as JSON

  --help, -h                             Show help
  --version, -v                          Show version
```

## Config File

Generator defaults can live in `ruah.conv.json`, `.ruah-conv.json`, or `ruah.conv.config.json`:

```json
{
  "target": "mcp-ts-server",
  "output": "./generated/server",
  "name": "Billing MCP Server",
  "transport": "streamable-http",
  "operationProfile": "standard"
}
```

If `operationProfile` is omitted, interactive OpenAPI/Swagger runs prompt for a preset. Non-interactive runs default to `standard`.

## Roadmap

### v0.1 — Core pipeline
- [x] OpenAPI 3.0 / 3.1 parser
- [x] Ruah Tool Schema IR
- [x] IR validation with warnings
- [x] MCP tool definitions (JSON)
- [x] CLI: generate, inspect, validate, targets
- [x] Plug-and-play with ruah CLI

### v0.2 — Expand
- [x] Full MCP TypeScript server scaffold (stdio transport)
- [x] Swagger 2.0 auto-upgrade
- [x] Postman collection parser
- [x] HTTP/SSE transport for MCP servers
- [x] Pagination handling

### v0.3 — Multi-target
- [x] MCP Python server (FastMCP)
- [x] Function calling schemas (OpenAI, Anthropic)
- [x] GraphQL SDL parser
- [x] A2A service wrapper
- [x] Config file support
- [x] Claude Code and Codex plugin bundle targets

### v0.4 — Real-world hardening
- [x] HAR capture input
- [x] Schema-driven auth wiring in scaffolds (`applyAuth` from `securitySchemes`)
- [x] Pagination detection and annotation in tool descriptions
- [x] `--no-auth-wiring` opt-out

### v0.5 — Operation profile + scaffold integrity
- [x] `--operation-profile` flag and interactive preset prompt (`read-only` / `standard` / `all`)
- [x] Scaffold-output integrity guarantees (every target writes files to `--output`)
- [x] Generated TypeScript compiles cleanly on Stripe- and GitHub-scale specs

### v0.6 — Planned
- [ ] Per-operation auth selection (honor `operation.security`)
- [ ] Runtime pagination wrapper in generated scaffolds
- [ ] Retry / backoff helper in generated scaffolds
- [ ] `--dry-run` mode

## Install

Stable release:

```bash
npm install -g @ruah-dev/cli
ruah conv generate ./spec.yaml --json
```

Standalone package:

```bash
npm install -g @ruah-dev/conv
ruah-conv generate ./spec.yaml --json

# or run without installing
npx @ruah-dev/conv generate ./spec.yaml --json
```

**Requirements:** Node.js 18+. Single runtime dependency: `yaml`.

## Release Flow

Releases are tag-driven:

```bash
git push origin main
git push origin v0.3.0
```

Pushing a `v*` tag triggers the GitHub Actions release pipeline, which:
- runs typecheck, lint, and tests for the root package and `packages/core`
- publishes `@ruah-dev/conv-core` first
- waits for that version to appear on npm
- publishes `@ruah-dev/conv`
- creates the GitHub release automatically

## Ecosystem

```
ruah       — top-level CLI router                    (@ruah-dev/cli)
conv       — standalone conv package + CLI wrapper   (@ruah-dev/conv)
conv-core  — conversion implementation               (@ruah-dev/conv-core)
```

## Community

- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

MIT
