import { existsSync } from "node:fs";
import type { ParsedArgs } from "../cli.js";
import { parse } from "../parsers/index.js";
import { bold, cyan, dim, logError } from "../utils/format.js";

export async function run(args: ParsedArgs): Promise<void> {
	const specFile = args._[1];
	if (!specFile) {
		logError("Missing spec file. Usage: ruah conv inspect <spec-file>");
		process.exit(1);
	}

	if (!existsSync(specFile)) {
		logError(`File not found: ${specFile}`);
		process.exit(1);
	}

	const jsonMode = Boolean(args.flags.json);
	const ir = parse(specFile);

	if (jsonMode) {
		process.stdout.write(JSON.stringify(ir, null, 2));
		process.stdout.write("\n");
		return;
	}

	// Human-readable summary
	console.log();
	console.log(bold("API Spec Summary"));
	console.log(dim("─".repeat(50)));
	console.log(`  Title:    ${cyan(ir.meta.title)}`);
	console.log(`  Version:  ${ir.meta.version}`);
	console.log(`  Format:   ${ir.meta.sourceFormat}`);
	if (ir.meta.baseUrl) {
		console.log(`  Base URL: ${ir.meta.baseUrl}`);
	}
	if (ir.meta.description) {
		console.log(`  Description: ${ir.meta.description}`);
	}

	// Auth schemes
	if (ir.auth.length > 0) {
		console.log();
		console.log(bold(`Auth Schemes (${ir.auth.length})`));
		for (const auth of ir.auth) {
			const detail = auth.scheme
				? ` (${auth.scheme})`
				: auth.name
					? ` (${auth.name})`
					: "";
			console.log(`  • ${auth.id}: ${auth.type}${detail}`);
		}
	}

	// Tools
	console.log();
	console.log(bold(`Tools (${ir.tools.length})`));
	for (const tool of ir.tools) {
		const params = tool.parameters.length;
		const body = tool.requestBody ? " +body" : "";
		const risk = tool.riskLevel !== "safe" ? dim(` [${tool.riskLevel}]`) : "";
		console.log(
			`  • ${cyan(tool.name)}  ${dim(tool.method)} ${dim(tool.path)}  ${dim(`(${params} params${body})`)}${risk}`,
		);
	}

	// Types
	const typeNames = Object.keys(ir.types);
	if (typeNames.length > 0) {
		console.log();
		console.log(bold(`Types (${typeNames.length})`));
		console.log(`  ${typeNames.join(", ")}`);
	}

	console.log();
}
