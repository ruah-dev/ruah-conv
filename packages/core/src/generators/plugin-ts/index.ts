import type { RuahToolSchema } from "../../ir/schema.js";
import type { GenerateOptions, GenerateResult } from "../index.js";
import { generate as generateMcpTsServer } from "../mcp-server-ts/index.js";

type PluginHost = "claude-code" | "codex";

const DEFAULT_VERSION = "0.1.0";

export function generateClaudeCodePlugin(
	spec: RuahToolSchema,
	options: GenerateOptions = {},
): GenerateResult {
	return generatePlugin(spec, options, "claude-code");
}

export function generateCodexPlugin(
	spec: RuahToolSchema,
	options: GenerateOptions = {},
): GenerateResult {
	return generatePlugin(spec, options, "codex");
}

function generatePlugin(
	spec: RuahToolSchema,
	options: GenerateOptions,
	host: PluginHost,
): GenerateResult {
	const serverResult = generateMcpTsServer(spec, options);
	const pluginName = sanitizePluginName(options.name ?? spec.meta.title);
	const displayName = sanitizeDisplayName(options.name ?? spec.meta.title);
	const description = buildDescription(spec, displayName);

	return {
		files: [
			...serverResult.files,
			{
				path:
					host === "claude-code"
						? ".claude-plugin/plugin.json"
						: ".codex-plugin/plugin.json",
				language: "json",
				content:
					host === "claude-code"
						? buildClaudePluginManifest(pluginName, description)
						: buildCodexPluginManifest(pluginName, displayName, description),
			},
			{
				path: ".mcp.json",
				language: "json",
				content:
					host === "claude-code"
						? buildClaudeMcpConfig(pluginName)
						: buildCodexMcpConfig(pluginName),
			},
		],
		summary: {
			...serverResult.summary,
			targetId:
				host === "claude-code" ? "claude-code-plugin-ts" : "codex-plugin-ts",
			warnings: [
				...serverResult.summary.warnings,
				...(host === "codex"
					? [
							"Codex plugin output uses a relative dist/index.js entrypoint in .mcp.json.",
						]
					: []),
			],
		},
	};
}

function buildClaudePluginManifest(
	pluginName: string,
	description: string,
): string {
	return JSON.stringify(
		{
			name: pluginName,
			version: DEFAULT_VERSION,
			description,
			author: {
				name: "ruah-conv",
			},
			mcpServers: "./.mcp.json",
		},
		null,
		2,
	);
}

function buildCodexPluginManifest(
	pluginName: string,
	displayName: string,
	description: string,
): string {
	return JSON.stringify(
		{
			name: pluginName,
			version: DEFAULT_VERSION,
			description,
			author: {
				name: "ruah-conv",
			},
			license: "MIT",
			keywords: ["mcp", "plugin", "openapi", "codex", "ruah"],
			mcpServers: "./.mcp.json",
			interface: {
				displayName,
				shortDescription: truncate(description, 96),
				longDescription: description,
				developerName: "ruah-conv",
				category: "Developer Tools",
				capabilities: ["Interactive", "Write"],
				defaultPrompt: [
					`List the available ${displayName} API tools.`,
					`Call ${displayName} to inspect data from the backing API.`,
					`Use ${displayName} to automate an API workflow.`,
				].map((prompt) => truncate(prompt, 128)),
				brandColor: "#2563EB",
			},
		},
		null,
		2,
	);
}

function buildClaudeMcpConfig(pluginName: string): string {
	return JSON.stringify(
		{
			mcpServers: {
				[pluginName]: {
					type: "stdio",
					command: "node",
					args: [String.raw`\${CLAUDE_PLUGIN_ROOT}/dist/index.js`],
					env: {},
				},
			},
		},
		null,
		2,
	);
}

function buildCodexMcpConfig(pluginName: string): string {
	return JSON.stringify(
		{
			mcpServers: {
				[pluginName]: {
					type: "stdio",
					command: "node",
					args: ["./dist/index.js"],
					env: {},
				},
			},
		},
		null,
		2,
	);
}

function buildDescription(spec: RuahToolSchema, displayName: string): string {
	const toolLabel = spec.tools.length === 1 ? "tool" : "tools";
	return `Generated plugin that exposes ${spec.tools.length} API ${toolLabel} from ${displayName} through MCP.`;
}

function sanitizeDisplayName(value: string): string {
	return value.replace(/[^a-z0-9]+/gi, " ").trim() || "Generated API";
}

function sanitizePluginName(value: string): string {
	return sanitizeDisplayName(value).toLowerCase().replace(/\s+/g, "-");
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength
		? value
		: `${value.slice(0, maxLength - 1)}...`;
}
