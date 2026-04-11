import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ParsedArgs } from "../cli.js";
import { loadConfig } from "../config.js";
import { generate, getTargets } from "../generators/index.js";
import { validateIR } from "../ir/validate.js";
import { parse } from "../parsers/index.js";
import { logError, logSuccess, logWarn } from "../utils/format.js";

export async function run(args: ParsedArgs): Promise<void> {
	const specFile = args._[1];
	if (!specFile) {
		logError("Missing spec file. Usage: ruah conv generate <spec-file>");
		process.exit(1);
	}

	if (!existsSync(specFile)) {
		logError(`File not found: ${specFile}`);
		process.exit(1);
	}

	const config = loadConfig(specFile, args.named.config as string | undefined);
	const targetId =
		(args.named.target as string | undefined) ??
		config.target ??
		"mcp-tool-defs";
	const outputDir =
		(args.named.output as string | undefined) ?? config.output ?? undefined;
	const jsonMode = args.flags.json ? true : Boolean(config.json);
	const name = (args.named.name as string | undefined) ?? config.name;
	const transport =
		(args.named.transport as
			| "stdio"
			| "streamable-http"
			| "sse"
			| "all"
			| undefined) ?? config.transport;

	// Validate target
	const targets = getTargets();
	if (!targets.find((t) => t.id === targetId)) {
		logError(
			`Unknown target: "${targetId}". Available: ${targets.map((t) => t.id).join(", ")}`,
		);
		process.exit(1);
	}

	// Parse
	const ir = parse(specFile);

	// Validate and warn
	const warnings = validateIR(ir);
	if (!jsonMode) {
		for (const w of warnings) {
			logWarn(`${w.path}: ${w.message}`);
		}
	}

	// Generate
	const result = generate(targetId, ir, {
		name,
		transport,
		outputPath: outputDir,
		json: jsonMode,
	});

	if (jsonMode) {
		// In JSON mode, output the first file's content directly to stdout
		const mainFile = result.files[0];
		if (mainFile) {
			process.stdout.write(mainFile.content);
			process.stdout.write("\n");
		}
		return;
	}

	// Write files
	if (outputDir) {
		const absOutput = resolve(outputDir);
		mkdirSync(absOutput, { recursive: true });

		for (const file of result.files) {
			const filePath = resolve(absOutput, file.path);
			writeFileSync(filePath, file.content, "utf8");
			logSuccess(`Written: ${filePath}`);
		}
	} else {
		// No output dir — print to stdout
		for (const file of result.files) {
			process.stdout.write(file.content);
			process.stdout.write("\n");
		}
	}

	if (!jsonMode) {
		console.log();
		logSuccess(`Generated ${result.summary.toolCount} tools → ${targetId}`);
		if (warnings.length > 0) {
			logWarn(
				`${warnings.length} warning(s) — run 'ruah conv validate' for details`,
			);
		}
	}
}
