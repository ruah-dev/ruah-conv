// Generator registry — maps target IDs to output generators.

import type { PluginConfig } from "../config.js";
import type { RuahToolSchema } from "../ir/schema.js";
import {
	capability as a2aCapability,
	generate as generateA2AWrapper,
} from "./a2a/index.js";
import {
	capability as anthropicCapability,
	generate as generateAnthropicTools,
} from "./anthropic/index.js";
import type { GeneratorCapability } from "./capability.js";
import {
	generate as generateMcpPythonServer,
	capability as mcpPythonCapability,
} from "./mcp-server-python/index.js";
import {
	generate as generateMcpTsServer,
	capability as mcpTsServerCapability,
} from "./mcp-server-ts/index.js";
import {
	generate as generateMcpToolDefs,
	capability as mcpToolDefsCapability,
} from "./mcp-ts/index.js";
import {
	generate as generateOpenAITools,
	capability as openaiCapability,
} from "./openai/index.js";
import {
	applyOperationProfile,
	buildEmptyOperationProfileError,
	type OperationProfile,
} from "./operation-profile.js";
import {
	claudeCodeCapability,
	codexCapability,
	generateClaudeCodePlugin,
	generateCodexPlugin,
} from "./plugin-ts/index.js";

// ── Public types ─────────────────────────────────────────────────────

export type { GeneratorCapability } from "./capability.js";

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
	operationProfile?: OperationProfile;
	plugin?: PluginConfig;
	/**
	 * When `true` (default) the scaffold targets that emit a runtime
	 * (`mcp-ts-server`, `mcp-python-server`, `a2a-wrapper`, plugin targets)
	 * generate code that reads auth credentials from environment variables
	 * and injects the headers/query params declared in the spec's auth
	 * schemes. Set to `false` to fall back to a no-op `applyAuth` stub the
	 * user fills in themselves.
	 */
	authWiring?: boolean;
	/**
	 * MCP search-then-load: expose `search_tools` / `get_tool_schema` /
	 * `invoke_tool` instead of registering every operation. For surfaces
	 * that stay large after (or instead of) curation.
	 */
	deferred?: boolean;
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
	{
		id: "claude-code-plugin-ts",
		name: "Claude Code Plugin",
		description:
			"Claude Code plugin scaffold with a TypeScript MCP server and plugin manifest",
	},
	{
		id: "codex-plugin-ts",
		name: "Codex Plugin",
		description:
			"Codex plugin scaffold with a TypeScript MCP server and plugin manifest",
	},
];

const CAPABILITIES: Record<string, GeneratorCapability> = {
	[mcpToolDefsCapability.id]: mcpToolDefsCapability,
	[mcpTsServerCapability.id]: mcpTsServerCapability,
	[mcpPythonCapability.id]: mcpPythonCapability,
	[openaiCapability.id]: openaiCapability,
	[anthropicCapability.id]: anthropicCapability,
	[a2aCapability.id]: a2aCapability,
	[claudeCodeCapability.id]: claudeCodeCapability,
	[codexCapability.id]: codexCapability,
};

/**
 * List all available output targets.
 */
export function getTargets(): GeneratorInfo[] {
	return TARGETS;
}

/**
 * Get the capability descriptor for a target, or `undefined` if unknown.
 */
export function getCapability(
	targetId: string,
): GeneratorCapability | undefined {
	return CAPABILITIES[targetId];
}

/**
 * Get a snapshot of every registered capability, keyed by target id.
 */
export function getCapabilities(): Readonly<
	Record<string, GeneratorCapability>
> {
	return CAPABILITIES;
}

/**
 * Generate output for the given target.
 */
export function generate(
	targetId: string,
	spec: RuahToolSchema,
	options?: GenerateOptions,
): GenerateResult {
	const nextSpec = options?.operationProfile
		? applyOperationProfile(spec, options.operationProfile)
		: spec;

	if (options?.operationProfile && nextSpec.tools.length === 0) {
		throw new Error(buildEmptyOperationProfileError(options.operationProfile));
	}

	switch (targetId) {
		case "mcp-tool-defs":
			return generateMcpToolDefs(nextSpec, options);
		case "mcp-ts-server":
			return generateMcpTsServer(nextSpec, options);
		case "mcp-python-server":
			return generateMcpPythonServer(nextSpec, options);
		case "openai-tools":
			return generateOpenAITools(nextSpec);
		case "anthropic-tools":
			return generateAnthropicTools(nextSpec);
		case "a2a-wrapper":
			return generateA2AWrapper(nextSpec, options);
		case "claude-code-plugin-ts":
			return generateClaudeCodePlugin(nextSpec, options);
		case "codex-plugin-ts":
			return generateCodexPlugin(nextSpec, options);
		default:
			throw new Error(
				`Unknown target: "${targetId}". Available: ${TARGETS.map((t) => t.id).join(", ")}`,
			);
	}
}
