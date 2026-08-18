import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stdin as stdinStream, stdout as stdoutStream } from "node:process";
import { createInterface } from "node:readline/promises";
import type { ParsedArgs } from "../cli.js";
import {
	applyCurate,
	type CurationDecision,
	type CurationGroup,
	type CurationPlan,
	parseCuratePreset,
	parseCurationPlan,
	proposeCurate,
	replayPlan,
} from "../curate/index.js";
import { finalizePlan } from "../curate/propose.js";
import { generate, getTargets } from "../generators/index.js";
import { parse } from "../parsers/index.js";
import { logError, logInfo, logSuccess } from "../utils/format.js";
import { writeGeneratedFiles } from "../utils/write-files.js";

export async function run(args: ParsedArgs): Promise<void> {
	const specFile = args._[1];
	if (!specFile) {
		logError(
			"Missing spec file. Usage: ruah conv curate <spec-file> [--preset standard] [--plan curation.json] [--out dir]",
		);
		process.exit(1);
	}
	if (!existsSync(specFile)) {
		logError(`File not found: ${specFile}`);
		process.exit(1);
	}

	const preset = parseCuratePreset(args.named.preset, "--preset") ?? "standard";
	const limitRaw = args.named.limit;
	const limit =
		limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : undefined;
	if (limitRaw !== undefined && (!Number.isFinite(limit) || (limit ?? 0) < 1)) {
		logError(`Invalid --limit "${limitRaw}". Expected a positive integer.`);
		process.exit(1);
	}

	const ir = parse(specFile);
	let plan = proposeCurate(ir, {
		preset,
		limit,
		source: specFile,
	});

	if (args.named.plan) {
		const planPath = args.named.plan;
		if (!existsSync(planPath)) {
			logError(`Plan file not found: ${planPath}`);
			process.exit(1);
		}
		let savedRaw: unknown;
		try {
			savedRaw = JSON.parse(readFileSync(planPath, "utf8"));
		} catch (err) {
			logError(
				`Invalid plan JSON: ${err instanceof Error ? err.message : String(err)}`,
			);
			process.exit(1);
		}
		const saved = parseCurationPlan(savedRaw);
		const replayed = replayPlan(plan, saved);
		plan = finalizePlan(ir, {
			preset: saved.preset ?? preset,
			source: specFile,
			groups: replayed.plan.groups,
			dropped: replayed.plan.dropped,
			drift: replayed.drift,
		});
	}

	if (args.flags.interactive) {
		if (args.flags.json) {
			logError("--interactive cannot be combined with --json");
			process.exit(1);
		}
		if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
			logInfo("--interactive ignored (not a TTY); applying defaults");
		} else {
			plan = await promptDecisions(ir, plan);
		}
	}

	const curated = applyCurate(ir, plan);
	const payload = {
		...plan,
		tools: curated.tools.map((tool) => ({
			name: tool.name,
			method: tool.method,
			path: tool.path,
			description: tool.description,
		})),
	};

	const outDir = args.named.out ?? args.named.output;
	if (outDir) {
		const abs = resolve(outDir);
		mkdirSync(abs, { recursive: true });
		writeFileSync(
			resolve(abs, "curation.json"),
			`${JSON.stringify(plan, null, 2)}\n`,
			"utf8",
		);
		writeFileSync(
			resolve(abs, "curated-ir.json"),
			`${JSON.stringify(curated, null, 2)}\n`,
			"utf8",
		);
		if (!args.flags.json) {
			logSuccess(`Wrote ${resolve(abs, "curation.json")}`);
		}
	}

	const targetId = args.named.target;
	if (targetId) {
		const targets = getTargets();
		if (!targets.find((target) => target.id === targetId)) {
			logError(
				`Unknown target: "${targetId}". Available: ${targets.map((t) => t.id).join(", ")}`,
			);
			process.exit(1);
		}
		const generated = generate(targetId, curated, {
			outputPath: outDir,
			json: Boolean(args.flags.json) && !outDir,
		});
		if (outDir) {
			writeGeneratedFiles(generated.files, outDir, {
				onWrite: (filePath) => {
					if (!args.flags.json) logSuccess(`Written: ${filePath}`);
				},
			});
		} else if (args.flags.json && generated.files[0]) {
			process.stdout.write(generated.files[0].content);
			process.stdout.write("\n");
			return;
		} else {
			for (const file of generated.files) {
				process.stdout.write(file.content);
				process.stdout.write("\n");
			}
		}
	}

	if (args.flags.json) {
		console.log(JSON.stringify(payload, null, 2));
		return;
	}

	printHuman(plan);
}

function printHuman(plan: CurationPlan): void {
	console.log(`# ruah-conv curate — ${plan.title}`);
	console.log(
		`this surface costs ~${plan.definitionTokens} tokens of definitions (${plan.totalTools} tools)`,
	);
	console.log(
		`curated set: ${plan.curatedTools} tools, ~${plan.curatedTokens} tokens  [${plan.preset}]`,
	);
	console.log("");

	const kept = plan.groups.filter((group) => group.decision !== "drop");
	for (const group of kept) {
		const mark = group.decision === "split" ? "split" : "keep ";
		console.log(
			`  ${mark}  ${group.name.padEnd(22)} ${group.members.length} ops  ${group.basePath}`,
		);
		for (const member of group.members) {
			console.log(
				`         ${member.action.padEnd(10)} ${member.method.padEnd(6)} ${member.path}`,
			);
		}
	}

	if (plan.dropped.length > 0) {
		console.log("");
		console.log(`dropped (${plan.dropped.length}):`);
		for (const item of plan.dropped) {
			console.log(`  ${item.method.padEnd(6)} ${item.path}  — ${item.reason}`);
		}
	}

	if (plan.heaviest.length > 0) {
		console.log("");
		console.log("heaviest original definitions:");
		for (const tool of plan.heaviest) {
			console.log(`  ~${tool.estTokens} tok  ${tool.name}`);
		}
	}

	if (plan.drift) {
		console.log("");
		console.log(
			`drift: +${plan.drift.added.length} / -${plan.drift.removed.length} endpoints since the saved plan`,
		);
		for (const item of plan.drift.added) {
			console.log(`  + ${item.method} ${item.path}`);
		}
		for (const item of plan.drift.removed) {
			console.log(`  - ${item.method} ${item.path}`);
		}
	}

	console.log("");
	console.log(plan.note);
}

async function promptDecisions(
	ir: ReturnType<typeof parse>,
	plan: CurationPlan,
): Promise<CurationPlan> {
	const rl = createInterface({ input: stdinStream, output: stdoutStream });
	const groups: CurationGroup[] = [];
	try {
		console.log(
			"Review each family. [a]ccept group  [s]plit  [d]rop  [q]uit (keep remaining defaults)",
		);
		for (const [index, group] of plan.groups.entries()) {
			if (group.decision === "drop" && group.reason === "over-budget") {
				groups.push(group);
				continue;
			}
			console.log("");
			console.log(
				`[${index + 1}/${plan.groups.length}] ${group.name}  (${group.members.length} ops, score ${group.score})`,
			);
			for (const member of group.members) {
				console.log(`    ${member.method.padEnd(6)} ${member.path}`);
			}
			const answer = (await rl.question("  [a/s/d/q] ")).trim().toLowerCase();
			if (answer === "q" || answer === "quit") {
				groups.push(group, ...plan.groups.slice(index + 1));
				break;
			}
			const decision: CurationDecision =
				answer === "s" || answer === "split"
					? "split"
					: answer === "d" || answer === "drop"
						? "drop"
						: "keep";
			groups.push({
				...group,
				decision,
				reason: decision === "keep" ? group.reason : `interactive:${decision}`,
			});
		}
	} finally {
		rl.close();
	}

	const dropped = [
		...plan.dropped.filter((item) =>
			groups.every(
				(group) =>
					group.decision === "drop" ||
					!group.members.some(
						(member) =>
							member.method === item.method && member.path === item.path,
					),
			),
		),
	];
	for (const group of groups) {
		if (group.decision !== "drop") continue;
		for (const member of group.members) {
			dropped.push({
				name: member.name,
				method: member.method,
				path: member.path,
				reason: group.reason,
			});
		}
	}

	return finalizePlan(ir, {
		preset: plan.preset,
		source: plan.source,
		groups,
		dropped,
		drift: plan.drift,
	});
}
