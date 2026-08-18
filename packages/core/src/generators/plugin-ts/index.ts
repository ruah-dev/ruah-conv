import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { PluginAuthorConfig } from "../../config.js";
import type { RuahToolSchema, Tool } from "../../ir/schema.js";
import type { GeneratorCapability } from "../capability.js";
import type { GenerateOptions, GenerateResult } from "../index.js";
import { generate as generateMcpTsServer } from "../mcp-server-ts/index.js";

type PluginHost = "claude-code" | "codex";

export const claudeCodeCapability: GeneratorCapability = {
	id: "claude-code-plugin-ts",
	label: "Claude Code Plugin",
	emits: "files",
	supportsTransport: true,
	supportsName: true,
	supportsDeferred: true,
};

export const codexCapability: GeneratorCapability = {
	id: "codex-plugin-ts",
	label: "Codex Plugin",
	emits: "files",
	supportsTransport: true,
	supportsName: true,
	supportsDeferred: true,
};

const DEFAULT_VERSION = "0.1.0";
const DEFAULT_AUTHOR_NAME = "ruah-conv";

interface AuthorBlock {
	name: string;
	url?: string;
	email?: string;
}

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
	const pluginConfig = options.plugin ?? {};
	const { spec: filteredSpec, hiddenCount } = applyHiddenTools(
		spec,
		pluginConfig.hiddenTools,
	);

	const serverResult = generateMcpTsServer(filteredSpec, options);

	const defaultDisplay = sanitizeDisplayName(
		options.name ?? filteredSpec.meta.title,
	);
	const defaultPluginName = toPluginSlug(defaultDisplay);

	const pluginName = pluginConfig.name
		? toPluginSlug(pluginConfig.name)
		: defaultPluginName;
	const displayName = pluginConfig.name
		? sanitizeDisplayName(pluginConfig.name)
		: defaultDisplay;
	const description =
		pluginConfig.description ?? buildDescription(filteredSpec, displayName);
	const author = resolveAuthor(pluginConfig.author);
	const iconInfo = resolveIcon(pluginConfig.icon);

	const warnings = [...serverResult.summary.warnings];
	if (iconInfo.warning) {
		warnings.push(iconInfo.warning);
	}
	if (hiddenCount > 0) {
		const noun = hiddenCount === 1 ? "tool" : "tools";
		warnings.push(
			`Plugin config hid ${hiddenCount} ${noun} from the generated manifest.`,
		);
	}
	if (host === "codex") {
		warnings.push(
			"Codex plugin output uses a relative dist/index.js entrypoint in .mcp.json.",
		);
	}

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
						? buildClaudePluginManifest(
								pluginName,
								description,
								author,
								iconInfo.value,
							)
						: buildCodexPluginManifest(
								pluginName,
								displayName,
								description,
								author,
								iconInfo.value,
							),
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
			warnings,
		},
	};
}

function applyHiddenTools(
	spec: RuahToolSchema,
	hiddenTools: string[] | undefined,
): { spec: RuahToolSchema; hiddenCount: number } {
	if (!hiddenTools || hiddenTools.length === 0) {
		return { spec, hiddenCount: 0 };
	}
	const hidden = new Set(hiddenTools);
	const filtered: Tool[] = spec.tools.filter((tool) => !hidden.has(tool.name));
	const hiddenCount = spec.tools.length - filtered.length;
	if (hiddenCount === 0) {
		return { spec, hiddenCount: 0 };
	}
	return {
		spec: { ...spec, tools: filtered },
		hiddenCount,
	};
}

function resolveAuthor(author: PluginAuthorConfig | undefined): AuthorBlock {
	const block: AuthorBlock = { name: author?.name ?? DEFAULT_AUTHOR_NAME };
	if (author?.url) block.url = author.url;
	if (author?.email) block.email = author.email;
	return block;
}

function resolveIcon(icon: string | undefined): {
	value: string | undefined;
	warning: string | undefined;
} {
	if (!icon) {
		return { value: undefined, warning: undefined };
	}
	const candidate = isAbsolute(icon) ? icon : resolve(process.cwd(), icon);
	if (!existsSync(candidate)) {
		return {
			value: icon,
			warning: `Plugin icon "${icon}" was referenced in the manifest but does not exist on disk.`,
		};
	}
	return { value: icon, warning: undefined };
}

function buildClaudePluginManifest(
	pluginName: string,
	description: string,
	author: AuthorBlock,
	icon: string | undefined,
): string {
	const manifest: Record<string, unknown> = {
		name: pluginName,
		version: DEFAULT_VERSION,
		description,
		author,
		mcpServers: "./.mcp.json",
	};
	if (icon) {
		manifest.icon = icon;
	}
	return JSON.stringify(manifest, null, 2);
}

function buildCodexPluginManifest(
	pluginName: string,
	displayName: string,
	description: string,
	author: AuthorBlock,
	icon: string | undefined,
): string {
	const interfaceBlock: Record<string, unknown> = {
		displayName,
		shortDescription: truncate(description, 96),
		longDescription: description,
		developerName: author.name,
		category: "Developer Tools",
		capabilities: ["Interactive", "Write"],
		defaultPrompt: [
			`List the available ${displayName} API tools.`,
			`Call ${displayName} to inspect data from the backing API.`,
			`Use ${displayName} to automate an API workflow.`,
		].map((prompt) => truncate(prompt, 128)),
		brandColor: "#2563EB",
	};
	if (icon) {
		interfaceBlock.icon = icon;
	}

	const manifest: Record<string, unknown> = {
		name: pluginName,
		version: DEFAULT_VERSION,
		description,
		author,
		license: "MIT",
		keywords: ["mcp", "plugin", "openapi", "codex", "ruah"],
		mcpServers: "./.mcp.json",
		interface: interfaceBlock,
	};
	if (icon) {
		manifest.icon = icon;
	}
	return JSON.stringify(manifest, null, 2);
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

function toPluginSlug(value: string): string {
	return sanitizeDisplayName(value).toLowerCase().replace(/\s+/g, "-");
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength
		? value
		: `${value.slice(0, maxLength - 1)}...`;
}
