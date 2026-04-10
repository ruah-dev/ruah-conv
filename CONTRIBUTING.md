# Contributing to ruah conv

Thanks for your interest in contributing! ruah conv converts API specs into agent-ready tool surfaces — here's how to get involved.

## Getting Started

```bash
# Clone the repo
git clone https://github.com/ruah-dev/ruah-conv.git
cd ruah-conv

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Typecheck
npm run typecheck

# Lint
npm run lint
```

## Project Structure

```
src/
  cli.ts                  Entry point, arg parser, command router
  index.ts                Public API for programmatic use
  commands/
    generate.ts           ruah conv generate — parse + generate output
    inspect.ts            ruah conv inspect — display IR summary
    validate.ts           ruah conv validate — check for issues
    targets.ts            ruah conv targets — list output targets
  parsers/
    index.ts              Parser registry + auto-detection
    openapi.ts            OpenAPI 3.0/3.1 → IR
  ir/
    schema.ts             TypeScript interfaces (the IR definition)
    validate.ts           IR validation + warning system
  generators/
    index.ts              Generator registry
    mcp-ts/
      index.ts            MCP tool definitions generator
  naming/
    index.ts              Tool naming policy + normalization
  utils/
    format.ts             Terminal colors, formatting helpers
test/
  fixtures/               Test corpus of real specs
  *.test.ts               Tests (node:test built-in runner)
```

## Architecture

The core design principle: **one IR in the middle**.

- **Parsers** normalize input specs (OpenAPI, etc.) into the Ruah Tool Schema IR
- **Generators** read the IR and produce output (MCP tool defs, etc.)
- Adding a new input = one parser. Adding a new output = one generator. Never N×M.

The `Parser` and `Generator` interfaces are defined in `src/parsers/index.ts` and `src/generators/index.ts`.

## Development Guidelines

### Minimal Runtime Dependencies

ruah conv ships with one runtime dependency: `yaml` (for YAML parsing). Keep this number as low as possible. If you need functionality that typically comes from a package, check if Node.js built-ins cover it first.

### TypeScript Strict Mode

The codebase uses `strict: true`. All code must pass `tsc --noEmit` with no errors.

### Testing

Tests use Node.js built-in test runner (`node:test`). No test frameworks.

```bash
# Run all tests
npm test

# Run a single test file
npx tsc -p tsconfig.test.json && node --test dist-test/test/naming.test.js
```

Every new feature or bug fix should include tests. The test suite currently has 47 tests.

### Linting & Formatting

We use [Biome](https://biomejs.dev/) for linting and formatting.

```bash
# Check
npm run lint

# Auto-fix
npm run format
```

### Commit Convention

```
type(scope): description

Co-Authored-By: Your Name <email>
```

Types: `feat`, `fix`, `docs`, `refactor`, `style`, `test`, `chore`

Examples:
- `feat: add Postman collection parser`
- `fix(openapi): handle circular $ref in schemas`
- `docs: update CLI reference with new flags`

### Branch Strategy

Trunk-based development on `main`. For contributions:

1. Fork the repo
2. Create a feature branch from `main`
3. Make your changes
4. Ensure all checks pass: `npm run typecheck && npm run lint && npm test`
5. Open a PR against `main`

## What to Contribute

### Good First Issues

Look for issues labeled [`good first issue`](https://github.com/ruah-dev/ruah-conv/labels/good%20first%20issue).

### Roadmap Items

These are planned features that would be great contributions:

- **Swagger 2.0 parser** — auto-upgrade Swagger 2.0 specs to OpenAPI 3.0 IR
- **Postman parser** — parse Postman v2.1 collections
- **MCP server scaffold** — full TypeScript MCP server project generation
- **Python output** — FastMCP server generation
- **Function calling schemas** — OpenAI and Anthropic format output
- **Pagination handling** — detect and handle cursor/offset pagination
- **Config file** — `.ruah/convert.json` for project defaults

### Adding a New Parser

1. Create `src/parsers/<format>.ts` implementing the parser
2. Register it in `src/parsers/index.ts`
3. Add test fixtures in `test/fixtures/`
4. Add tests in `test/parser-<format>.test.ts`

### Adding a New Generator

1. Create `src/generators/<target>/index.ts` implementing the generator
2. Register it in `src/generators/index.ts`
3. Add tests in `test/generator-<target>.test.ts`

## Running the CLI Locally

During development, run directly from the compiled output:

```bash
npm run build
node dist/cli.js --help
node dist/cli.js inspect test/fixtures/clean/petstore.yaml
node dist/cli.js generate test/fixtures/clean/petstore.yaml --json
```

## Release Process

Releases are automated. Maintainers tag and push:

```bash
npm version patch   # or minor, major
git push --tags
```

GitHub Actions handles: typecheck → lint → test → npm publish → GitHub Release.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
