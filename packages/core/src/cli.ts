#!/usr/bin/env node

// @ruah-dev/conv-core — convert API specs to agent-ready tool surfaces

import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { label, logError } from "./utils/format.js";
import {
	formatTopLevelCliNotice,
	getPreferredConvCommand,
} from "./utils/top-level-cli.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Arg parsing (matches ruah-orch convention) ───────────────────────

export interface ParsedArgs {
	_: string[];
	flags: Record<string, boolean>;
	named: Record<string, string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
	const args: ParsedArgs = { _: [], flags: {}, named: {} };
	let i = 0;

	while (i < argv.length) {
		const arg = argv[i];

		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			const next = argv[i + 1];

			if (next && !next.startsWith("-")) {
				args.named[key] = next;
				i += 2;
				continue;
			}
			args.flags[key] = true;
		} else if (arg.startsWith("-") && arg.length === 2) {
			args.flags[arg.slice(1)] = true;
		} else {
			args._.push(arg);
		}
		i++;
	}

	return args;
}

// ── Version ──────────────────────────────────────────────────────────

function getVersion(): string {
	try {
		const pkg = JSON.parse(
			readFileSync(resolve(__dirname, "..", "package.json"), "utf8"),
		) as { version?: string };
		return pkg.version ?? "unknown";
	} catch {
		return "unknown";
	}
}

// ── Help ─────────────────────────────────────────────────────────────

function buildHelp(): string {
	const command = getPreferredConvCommand();

	return `
${label()} — How do I make this API agent-sized?

curate is the headline. Conversion is the engine. Every generate prints
the definition token footprint.

Usage:
  ${command} curate <spec-file> [--preset minimal|standard|full] [--plan curation.json] [--out dir] [--json]
  ${command} generate <spec-file> [--target mcp-tool-defs] [--output <dir>] [--name <server-name>] [--operation-profile <read-only|standard|all>] [--curate] [--plan curation.json] [--deferred] [--json]
  ${command} inspect <spec-file> [--json]
  ${command} validate <spec-file> [--json]
  ${command} targets [--json]

Commands:
  generate    Parse spec and produce output for the given target
  inspect     Parse spec and display the IR (tools, types, auth)
  curate      Group endpoints into ≤10 task tools and emit a replayable plan
  validate    Parse spec and report warnings
  targets     List available output targets

Options:
  --target <id>        Output target (default: mcp-tool-defs)
  --output <dir>       Output directory (default: stdout)
  --out <dir>          Write curation.json (+ optional generated files)
  --name <value>       Override generated server/service name
  --transport <mode>   Generator transport hint (stdio, streamable-http, sse, all)
  --operation-profile <profile>
                       OpenAPI/Swagger operation preset (read-only, standard, all)
  --preset <id>        Curation preset: minimal, standard (default), full
  --plan <file>        Replay a saved curation.json (reports drift)
  --curate             Apply default curation before generate
  --deferred           MCP search-then-load (search_tools + get_tool_schema + invoke_tool)
  --limit <n>          Cap curated task tools (overrides preset)
  --interactive        Walk each family: accept / split / drop
  --config <path>      Load generation defaults from a JSON config file
  --no-auth-wiring     Skip schema-driven auth wiring in scaffold targets
  --verbose            Print every validation warning (default: one-line summary)
  --json               Output as JSON (for composition with other tools)
  --help, -h           Show this help
  --version, -v        Show version

Examples:
  ${command} curate petstore.yaml --json
  ${command} generate petstore.yaml --json
  ${command} curate petstore.yaml --out ./curated --preset standard
  ${command} generate petstore.yaml --curate --target mcp-tool-defs --json
  ${command} generate petstore.yaml --plan curation.json --output ./generated/
  ${command} generate stripe.yaml --deferred --target mcp-ts-server --output ./server

CLI:
  ${formatTopLevelCliNotice()}
`;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	if (args.flags.help || args.flags.h) {
		console.log(buildHelp().trim());
		return;
	}

	if (args.flags.version || args.flags.v) {
		console.log(`ruah conv v${getVersion()}`);
		return;
	}

	const command = args._[0];

	if (!command) {
		console.log(buildHelp().trim());
		return;
	}

	try {
		switch (command) {
			case "generate": {
				const { run } = await import("./commands/generate.js");
				await run(args);
				break;
			}
			case "inspect": {
				const { run } = await import("./commands/inspect.js");
				await run(args);
				break;
			}
			case "curate": {
				const { run } = await import("./commands/curate.js");
				await run(args);
				break;
			}
			case "validate": {
				const { run } = await import("./commands/validate.js");
				await run(args);
				break;
			}
			case "targets": {
				const { run } = await import("./commands/targets.js");
				await run(args);
				break;
			}
			default:
				logError(`Unknown command: '${command}'`);
				console.error("Run 'ruah conv --help' for usage.");
				process.exit(1);
		}
	} catch (err) {
		if (process.env.RUAH_DEBUG) {
			console.error(err);
		} else {
			logError(err instanceof Error ? err.message : String(err));
		}
		process.exit(1);
	}
}

try {
	if (
		process.argv[1] &&
		realpathSync(resolve(process.argv[1])) ===
			realpathSync(fileURLToPath(import.meta.url))
	) {
		void main();
	}
} catch {
	void main();
}
