import { existsSync } from "node:fs";
import type { ParsedArgs } from "../cli.js";
import { validateIR } from "../ir/validate.js";
import { parse } from "../parsers/index.js";
import {
	green,
	logError,
	logSuccess,
	logWarn,
	yellow,
} from "../utils/format.js";

export async function run(args: ParsedArgs): Promise<void> {
	const specFile = args._[1];
	if (!specFile) {
		logError("Missing spec file. Usage: ruah conv validate <spec-file>");
		process.exit(1);
	}

	if (!existsSync(specFile)) {
		logError(`File not found: ${specFile}`);
		process.exit(1);
	}

	const jsonMode = Boolean(args.flags.json);

	const ir = parse(specFile);
	const warnings = validateIR(ir);

	if (jsonMode) {
		process.stdout.write(
			JSON.stringify(
				{
					valid: true,
					toolCount: ir.tools.length,
					typeCount: Object.keys(ir.types).length,
					warnings,
				},
				null,
				2,
			),
		);
		process.stdout.write("\n");
		return;
	}

	if (warnings.length === 0) {
		logSuccess(
			`Spec is valid — ${ir.tools.length} tools, ${Object.keys(ir.types).length} types, no warnings.`,
		);
		return;
	}

	console.log();
	for (const w of warnings) {
		const prefix = w.code === "no-operations" ? logError : logWarn;
		prefix(`${yellow(w.path)}: ${w.message}`);
	}

	console.log();
	console.log(
		`${green(String(ir.tools.length))} tools, ${warnings.length} warning(s)`,
	);
}
