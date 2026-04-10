# ruah conv

[![npm version](https://img.shields.io/npm/v/@ruah-dev/conv)](https://www.npmjs.com/package/@ruah-dev/conv)
[![license](https://img.shields.io/npm/l/@ruah-dev/conv)](LICENSE)
[![tests](https://img.shields.io/badge/tests-47%20passing-brightgreen)](test/)

**Convert API specs into agent-ready tool surfaces.**

Feed it an OpenAPI spec, get MCP tool definitions, function-calling schemas, or a full MCP server scaffold. One intermediate representation in the middle — every input parser normalizes to it, every output generator reads from it.

```
 Input Parsers              IR                    Output Generators
 ─────────────        ──────────────            ─────────────────────
 OpenAPI 3.x  ──┐                            ┌── MCP Tool Definitions ✓
 Swagger 2.0  ──┤                            ├── MCP Server (TS)
 Postman v2.1 ──┼──→  Ruah Tool Schema  ───┼── MCP Server (Python)
 GraphQL SDL  ──┤     (canonical IR)         ├── Function Calling (OpenAI)
 HAR files    ──┘                            ├── Function Calling (Anthropic)
                                             └── A2A service wrapper
```

**v0.1 ships:** OpenAPI 3.0/3.1 parser → MCP tool definitions (JSON). The rest follows.

## See It

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
# Generate MCP tool definitions (JSON)
ruah conv generate ./spec.yaml --target mcp-tool-defs --json

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

## How It Works

### 1. Parse

The parser reads OpenAPI 3.0 or 3.1 specs (YAML or JSON), resolves `$ref` references, and normalizes everything into the **Ruah Tool Schema** — the canonical intermediate representation.

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

The generator reads the IR and produces output for the target format. Currently ships with `mcp-tool-defs` — a JSON array of MCP-compatible tool definitions.

Each tool gets:
- **name** — normalized from `operationId` (or synthesized from method + path)
- **description** — from the spec's `summary` or `description`
- **inputSchema** — JSON Schema combining path params, query params, and request body

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
| PATCH | `moderate` | No | No |
| DELETE | `destructive` | Yes | No |

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

## Roadmap

### v0.1 — Core pipeline (current)
- [x] OpenAPI 3.0 / 3.1 parser
- [x] Ruah Tool Schema IR
- [x] IR validation with warnings
- [x] MCP tool definitions (JSON)
- [x] CLI: generate, inspect, validate, targets
- [x] Plug-and-play with ruah CLI

### v0.2 — Expand
- [ ] Full MCP TypeScript server scaffold (stdio transport)
- [ ] Swagger 2.0 auto-upgrade
- [ ] Postman collection parser
- [ ] HTTP/SSE transport for MCP servers
- [ ] Pagination handling

### v0.3 — Multi-target
- [ ] MCP Python server (FastMCP)
- [ ] Function calling schemas (OpenAI, Anthropic)
- [ ] GraphQL SDL parser
- [ ] A2A service wrapper
- [ ] Config file support

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
npx @ruah-dev/conv <command>
```

**Requirements:** Node.js 18+. Single runtime dependency: `yaml`.

## Ecosystem

```
ruah  — top-level CLI router                          (@ruah-dev/cli)
orch  — multi-agent orchestration                     (@ruah-dev/orch)
conv  — API spec → agent tool surfaces                (@ruah-dev/conv)
```

## Community

- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

MIT
