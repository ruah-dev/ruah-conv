#!/usr/bin/env node

// @ruah-dev/conv — convert API specs to agent-ready tool surfaces

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	formatTopLevelCliNotice,
	getPreferredConvCommand,
} from "./utils/top-level-cli.js";
import { label, logError } from "./utils/format.js";

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
${label()} — convert API specs to agent-ready tool surfaces

Usage:
  ${command} generate <spec-file> [--target mcp-tool-defs] [--output <dir>] [--json]
  ${command} inspect <spec-file> [--json]
  ${command} validate <spec-file> [--json]
  ${command} targets [--json]

Commands:
  generate    Parse spec and produce output for the given target
  inspect     Parse spec and display the IR (tools, types, auth)
  validate    Parse spec and report warnings
  targets     List available output targets

Options:
  --target <id>   Output target (default: mcp-tool-defs)
  --output <dir>  Output directory (default: stdout)
  --json          Output as JSON (for composition with other tools)
  --help, -h      Show this help
  --version, -v   Show version

Examples:
  ${command} generate petstore.yaml --json
  ${command} inspect petstore.yaml
  ${command} validate petstore.yaml --json
  ${command} generate petstore.yaml --target mcp-tool-defs --output ./generated/

CLI:
  ${formatTopLevelCliNotice()}
  Standalone binary: ruah-conv
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
		console.log(`ruah-conv v${getVersion()}`);
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

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	main();
}
