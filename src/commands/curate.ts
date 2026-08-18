import { existsSync } from "node:fs";
import type { ParsedArgs } from "../cli.js";
import { parse } from "../parsers/index.js";
import { logError } from "../utils/format.js";

interface RankedTool {
	name: string;
	method: string;
	path: string;
	score: number;
	estTokens: number;
}

function scoreTool(method: string, path: string): number {
	const m = method.toUpperCase();
	const segments = path.split("/").filter(Boolean);
	const isCollection = !segments.some((s) => s.startsWith("{") || s.startsWith(":"));
	let score = 5;
	if (m === "GET" && isCollection) score = 10;
	else if (m === "GET") score = 8;
	else if (m === "POST" && isCollection) score = 7;
	else if (m === "PUT" || m === "PATCH") score = 5;
	else if (m === "DELETE") score = 4;
	if (segments.length > 4) score -= 1;
	return score;
}

function estimateTokens(value: unknown): number {
	return Math.max(1, Math.round(JSON.stringify(value).length / 4));
}

export async function run(args: ParsedArgs): Promise<void> {
	const specFile = args._[1];
	if (!specFile) {
		logError("Missing spec file. Usage: ruah conv curate <spec-file>");
		process.exit(1);
	}
	if (!existsSync(specFile)) {
		logError(`File not found: ${specFile}`);
		process.exit(1);
	}

	const ir = parse(specFile);
	const ranked: RankedTool[] = ir.tools
		.map((tool) => ({
			name: tool.name,
			method: tool.method,
			path: tool.path,
			score: scoreTool(tool.method, tool.path),
			estTokens: estimateTokens({
				name: tool.name,
				method: tool.method,
				path: tool.path,
				parameters: tool.parameters,
				requestBody: tool.requestBody,
			}),
		}))
		.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

	const limit = 10;
	const picked = ranked.slice(0, Math.min(limit, ranked.length));
	const totalTokens = ranked.reduce((sum, t) => sum + t.estTokens, 0);
	const curatedTokens = picked.reduce((sum, t) => sum + t.estTokens, 0);
	const heaviest = [...ranked].sort((a, b) => b.estTokens - a.estTokens).slice(0, 3);

	const payload = {
		schemaVersion: "1",
		source: specFile,
		title: ir.meta.title,
		totalTools: ranked.length,
		curatedTools: picked.length,
		definitionTokens: totalTokens,
		curatedTokens,
		heaviest: heaviest.map((t) => ({ name: t.name, estTokens: t.estTokens })),
		picked,
		note: "Heuristic rank only — not a full merge of endpoints into task tools.",
	};

	if (args.flags.json) {
		console.log(JSON.stringify(payload, null, 2));
		return;
	}

	console.log(`# ruah-conv curate — ${ir.meta.title}`);
	console.log(
		`this surface costs ~${totalTokens} tokens of definitions (${ranked.length} tools)`,
	);
	console.log(
		`curated set: ${picked.length} tools, ~${curatedTokens} tokens`,
	);
	console.log("");
	for (const tool of picked) {
		console.log(`  ${tool.score.toString().padStart(2)}  ${tool.method.padEnd(6)} ${tool.path}  (${tool.name})`);
	}
	if (heaviest.length > 0) {
		console.log("");
		console.log("heaviest definitions:");
		for (const tool of heaviest) {
			console.log(`  ~${tool.estTokens} tok  ${tool.name}`);
		}
	}
}
