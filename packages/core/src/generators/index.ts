// Generator registry — maps target IDs to output generators.

import type { RuahToolSchema } from "../ir/schema.js";
import { generate as generateA2AWrapper } from "./a2a/index.js";
import { generate as generateAnthropicTools } from "./anthropic/index.js";
import { generate as generateMcpPythonServer } from "./mcp-server-python/index.js";
import { generate as generateMcpTsServer } from "./mcp-server-ts/index.js";
import { generate as generateMcpToolDefs } from "./mcp-ts/index.js";
import { generate as generateOpenAITools } from "./openai/index.js";

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
	transport?: "stdio" | "streamable-http" | "sse" | "all";
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
	{
		id: "mcp-ts-server",
		name: "MCP TypeScript Server",
		description:
			"TypeScript MCP server scaffold with stdio entrypoint and HTTP transport starter",
	},
	{
		id: "mcp-python-server",
		name: "MCP Python Server",
		description:
			"FastMCP Python server scaffold with stdio and streamable-http support",
	},
	{
		id: "openai-tools",
		name: "OpenAI Tools",
		description: "OpenAI function/tool definitions JSON",
	},
	{
		id: "anthropic-tools",
		name: "Anthropic Tools",
		description: "Anthropic tool definitions JSON",
	},
	{
		id: "a2a-wrapper",
		name: "A2A Wrapper",
		description: "Service wrapper scaffold for agent-to-agent style invocation",
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
	options?: GenerateOptions,
): GenerateResult {
	switch (targetId) {
		case "mcp-tool-defs":
			return generateMcpToolDefs(spec);
		case "mcp-ts-server":
			return generateMcpTsServer(spec, options);
		case "mcp-python-server":
			return generateMcpPythonServer(spec, options);
		case "openai-tools":
			return generateOpenAITools(spec);
		case "anthropic-tools":
			return generateAnthropicTools(spec);
		case "a2a-wrapper":
			return generateA2AWrapper(spec, options);
		default:
			throw new Error(
				`Unknown target: "${targetId}". Available: ${TARGETS.map((t) => t.id).join(", ")}`,
			);
	}
}
