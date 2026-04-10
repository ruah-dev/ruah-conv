// Generator registry — maps target IDs to output generators.

import type { RuahToolSchema } from "../ir/schema.js";
import { generate as generateMcpToolDefs } from "./mcp-ts/index.js";

// ── Public types ─────────────────────────────────────────────────────

export interface GeneratorInfo {
	id: string;
	name: string;
	description: string;
}

export interface GenerateOptions {
	outputPath?: string;
	json?: boolean;
	name?: string;
}

export interface GenerateResult {
	files: GeneratedFile[];
	summary: {
		toolCount: number;
		typeCount: number;
		targetId: string;
		warnings: string[];
	};
}

export interface GeneratedFile {
	path: string;
	content: string;
	language: "typescript" | "python" | "json" | "yaml";
}

// ── Registry ─────────────────────────────────────────────────────────

const TARGETS: GeneratorInfo[] = [
	{
		id: "mcp-tool-defs",
		name: "MCP Tool Definitions",
		description:
			"JSON array of MCP-compatible tool definitions (name, description, inputSchema)",
	},
];

/**
 * List all available output targets.
 */
export function getTargets(): GeneratorInfo[] {
	return TARGETS;
}

/**
 * Generate output for the given target.
 */
export function generate(
	targetId: string,
	spec: RuahToolSchema,
	_options?: GenerateOptions,
): GenerateResult {
	switch (targetId) {
		case "mcp-tool-defs":
			return generateMcpToolDefs(spec);
		default:
			throw new Error(
				`Unknown target: "${targetId}". Available: ${TARGETS.map((t) => t.id).join(", ")}`,
			);
	}
}
