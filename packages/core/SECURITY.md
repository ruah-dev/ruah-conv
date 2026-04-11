# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in ruah conv, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email **peter.whzm@gmail.com** with:

- A description of the vulnerability
- Steps to reproduce it
- The potential impact
- Any suggested fix (optional)

You will receive an acknowledgment within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Security Considerations

ruah conv is a local CLI tool that parses API specifications and generates code. Key security areas:

### Input Parsing

ruah conv parses user-provided OpenAPI specs (YAML/JSON). The YAML parser (`yaml` npm package) is well-maintained and handles untrusted input safely. However, specs with extremely deep nesting or circular references are bounded by the parser's depth limits.

### Code Generation

Generated output (MCP tool definitions, server scaffolds) is written to the local filesystem only. No generated code is executed automatically. Users should review generated code before running it, especially auth middleware.

### File System

ruah conv reads spec files and writes generated output to user-specified directories. No files are written outside the specified output path. No temporary files are created.

### No Network Access

ruah conv makes no network requests. Spec files must be local. Remote URL support (fetching specs from URLs) is planned for a future version and will be opt-in.

### No Secrets

ruah conv never reads, stores, or transmits credentials, API keys, or tokens. Auth schemes in specs are converted to metadata only — no actual credentials are handled.

### Dependencies

ruah conv has one runtime dependency: `yaml` (YAML parser). The attack surface from supply chain compromises is minimal. Dev dependencies (TypeScript, Biome, @types/node) are not shipped in the published package.
