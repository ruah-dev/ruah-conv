import { existsSync, readFileSync } from "node:fs";
import type { ParsedArgs } from "../cli.js";
import { loadConfig } from "../config.js";
import {
	applyCurate,
	parseCuratePreset,
	parseCurationPlan,
	proposeCurate,
	replayPlan,
} from "../curate/index.js";
import { finalizePlan } from "../curate/propose.js";
import {
	formatSurfaceCost,
	generate,
	getCapability,
	getTargets,
} from "../generators/index.js";
import {
	applyOperationProfile,
	buildEmptyOperationProfileError,
	countExcludedToolsByOperationProfile,
	parseOperationProfile,
} from "../generators/operation-profile.js";
import type { RuahToolSchema } from "../ir/schema.js";
import { summarizeWarnings, validateIR } from "../ir/validate.js";
import { parse } from "../parsers/index.js";
import { applyPaginationOverrides } from "../parsers/shared.js";
import { logError, logInfo, logSuccess, logWarn } from "../utils/format.js";
import { writeGeneratedFiles } from "../utils/write-files.js";
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
	// `--no-auth-wiring` (boolean) disables schema-driven auth wiring. Falls
	// back to `authWiring: false` in ruah.conv.json; default is enabled.
	const authWiringFlag =
		args.flags["no-auth-wiring"] === true ||
		args.named["no-auth-wiring"] !== undefined
			? false
			: undefined;
	const authWiring =
		authWiringFlag !== undefined ? authWiringFlag : (config.authWiring ?? true);
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

	// Validate flags against the target's capability descriptor.
	const capability = getCapability(targetId);
	if (capability) {
		const transportProvided =
			args.named.transport !== undefined || config.transport !== undefined;
		if (transportProvided && !capability.supportsTransport) {
			const transportTargets = targets
				.filter((t) => getCapability(t.id)?.supportsTransport === true)
				.map((t) => t.id);
			logError(
				`--transport is not supported by target "${targetId}". Supported: ${transportTargets.join(", ")}.`,
			);
			process.exit(1);
		}

		if (jsonMode && capability.emits === "files") {
			logError(
				`--json is not supported for multi-file target "${targetId}". Use --output <dir> instead.`,
			);
			process.exit(1);
		}

		const nameProvided =
			args.named.name !== undefined || config.name !== undefined;
		if (nameProvided && !capability.supportsName) {
			logWarn(
				`--name has no effect on target "${targetId}"; the value will be ignored.`,
			);
		}

		if (args.flags.deferred && capability.supportsDeferred !== true) {
			const deferredTargets = targets
				.filter((t) => getCapability(t.id)?.supportsDeferred === true)
				.map((t) => t.id);
			logError(
				`--deferred is not supported by target "${targetId}". Supported: ${deferredTargets.join(", ")}.`,
			);
			process.exit(1);
		}
	}

	// Parse
	const parsedIr = parse(specFile);
	const paginatedIr = applyPaginationOverrides(parsedIr, config.pagination);
	const ir = applyOptionalCurate(paginatedIr, args, specFile, jsonMode);
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
	const verbose =
		args.flags.verbose === true || args.named.verbose !== undefined;
	if (!jsonMode && verbose) {
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
		plugin: config.plugin,
		authWiring,
		deferred: Boolean(args.flags.deferred),
	});

	if (jsonMode) {
		// The capability check above already rejects multi-file targets in JSON
		// mode; this is a defensive fallback for unknown targets (no capability).
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
		// Cost stays on stderr so `--json` pipes remain a pure artifact.
		console.error(formatSurfaceCost(result.summary));
		return;
	}

	// Write files
	if (outputDir) {
		writeGeneratedFiles(result.files, outputDir, {
			onWrite: (filePath) => logSuccess(`Written: ${filePath}`),
		});
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
		logInfo(formatSurfaceCost(result.summary));
		if ((result.summary.heaviest ?? []).length > 0) {
			for (const tool of result.summary.heaviest ?? []) {
				console.error(`  ~${tool.estTokens} tok  ${tool.name}`);
			}
		}
		if (operationProfile) {
			const noun = excludedOperationCount === 1 ? "operation" : "operations";
			const excluded =
				excludedOperationCount > 0
					? ` (excluded ${excludedOperationCount} ${noun})`
					: "";
			logInfo(`Operation profile: ${operationProfile}${excluded}`);
		}
		if (warnings.length > 0) {
			logWarn(summarizeWarnings(warnings));
			if (!verbose) {
				console.log(
					`  Run with --verbose, or 'ruah conv validate' for full details.`,
				);
			}
		}
	}
}

function applyOptionalCurate(
	ir: RuahToolSchema,
	args: ParsedArgs,
	specFile: string,
	jsonMode: boolean,
): RuahToolSchema {
	const wantsCurate = Boolean(args.flags.curate) || Boolean(args.named.plan);
	if (!wantsCurate) return ir;

	const preset = parseCuratePreset(args.named.preset, "--preset") ?? "standard";
	let plan = proposeCurate(ir, { preset, source: specFile });

	if (args.named.plan) {
		if (!existsSync(args.named.plan)) {
			logError(`Plan file not found: ${args.named.plan}`);
			process.exit(1);
		}
		let savedRaw: unknown;
		try {
			savedRaw = JSON.parse(readFileSync(args.named.plan, "utf8"));
		} catch (err) {
			logError(
				`Invalid plan JSON: ${err instanceof Error ? err.message : String(err)}`,
			);
			process.exit(1);
		}
		const replayed = replayPlan(plan, parseCurationPlan(savedRaw));
		plan = finalizePlan(ir, {
			preset: replayed.plan.preset,
			source: specFile,
			groups: replayed.plan.groups,
			dropped: replayed.plan.dropped,
			drift: replayed.drift,
		});
		if (!jsonMode && plan.drift) {
			const { added, removed } = plan.drift;
			if (added.length + removed.length > 0) {
				logInfo(
					`Curation drift: +${added.length} / -${removed.length} endpoints since the saved plan`,
				);
			}
		}
	}

	const curated = applyCurate(ir, plan);
	if (!jsonMode) {
		logInfo(
			`Curated ${plan.totalTools} endpoints → ${plan.curatedTools} tools (~${plan.curatedTokens} tok, was ~${plan.definitionTokens})`,
		);
	}
	return curated;
}
