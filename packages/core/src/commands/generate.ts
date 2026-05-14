import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ParsedArgs } from "../cli.js";
import { loadConfig } from "../config.js";
import { generate, getTargets } from "../generators/index.js";
import {
	applyOperationProfile,
	buildEmptyOperationProfileError,
	countExcludedToolsByOperationProfile,
	parseOperationProfile,
} from "../generators/operation-profile.js";
import { validateIR } from "../ir/validate.js";
import { parse } from "../parsers/index.js";
import { logError, logInfo, logSuccess, logWarn } from "../utils/format.js";
import { resolveOperationProfile } from "./generate-profile.js";
import { promptForOperationProfile } from "./generate-prompt.js";

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
	const explicitOperationProfile = parseOperationProfile(
		args.named["operation-profile"] as string | undefined,
		"--operation-profile",
	);
	const configOperationProfile = parseOperationProfile(
		config.operationProfile,
		"config operationProfile",
	);

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
	const profileResolution = resolveOperationProfile({
		sourceFormat: ir.meta.sourceFormat,
		jsonMode,
		stdinIsTTY: process.stdin.isTTY === true,
		stdoutIsTTY: process.stdout.isTTY === true,
		ci: Boolean(process.env.CI),
		explicitProfile: explicitOperationProfile,
		configProfile: configOperationProfile,
	});

	const operationProfile =
		profileResolution.kind === "prompt"
			? await promptForOperationProfile(ir)
			: profileResolution.kind === "resolved"
				? profileResolution.profile
				: undefined;
	const filteredIr = operationProfile
		? applyOperationProfile(ir, operationProfile)
		: ir;
	const excludedOperationCount = operationProfile
		? countExcludedToolsByOperationProfile(ir.tools, operationProfile)
		: 0;

	if (operationProfile && filteredIr.tools.length === 0) {
		logError(buildEmptyOperationProfileError(operationProfile));
		process.exit(1);
	}

	// Validate and warn
	const warnings = validateIR(filteredIr);
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
		operationProfile,
	});

	if (jsonMode) {
		if (result.files.length > 1) {
			logError(
				`--json is not supported for multi-file target "${targetId}" (would emit ${result.files.length} files). Use --output <dir> instead.`,
			);
			process.exit(1);
		}
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
			mkdirSync(dirname(filePath), { recursive: true });
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
		if (operationProfile) {
			const noun = excludedOperationCount === 1 ? "operation" : "operations";
			const excluded =
				excludedOperationCount > 0
					? ` (excluded ${excludedOperationCount} ${noun})`
					: "";
			logInfo(`Operation profile: ${operationProfile}${excluded}`);
		}
		if (warnings.length > 0) {
			logWarn(
				`${warnings.length} warning(s) — run 'ruah conv validate' for details`,
			);
		}
	}
}
