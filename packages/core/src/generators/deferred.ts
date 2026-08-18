import type { RuahToolSchema } from "../ir/schema.js";
import { buildToolDefinitions, type ToolDefinition } from "./shared.js";

export const DEFERRED_SEARCH = "search_tools";
export const DEFERRED_SCHEMA = "get_tool_schema";
export const DEFERRED_INVOKE = "invoke_tool";

export const DEFERRED_TOOL_NAMES = [
	DEFERRED_SEARCH,
	DEFERRED_SCHEMA,
	DEFERRED_INVOKE,
] as const;

export interface DeferredCatalogEntry {
	name: string;
	description: string;
	method: string;
	path: string;
	risk: ToolDefinition["_meta"]["ruah"]["risk"];
}

export interface DeferredSchemaEntry {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

/**
 * Search-then-load catalog. The agent sees three meta-tools instead of
 * every operation. Worth it when the surface is still large after curation
 * (or when you skip curation on a 100+ endpoint spec).
 */
export function buildDeferredCatalog(
	spec: RuahToolSchema,
	maxDescriptionChars = 160,
): DeferredCatalogEntry[] {
	return buildToolDefinitions(spec).map((tool) => ({
		name: tool.name,
		description: truncateDescription(tool.description, maxDescriptionChars),
		method: tool._meta.ruah.method,
		path: tool._meta.ruah.path,
		risk: tool._meta.ruah.risk,
	}));
}

export function buildDeferredSchemas(
	spec: RuahToolSchema,
): Record<string, DeferredSchemaEntry> {
	const schemas: Record<string, DeferredSchemaEntry> = {};
	for (const tool of buildToolDefinitions(spec)) {
		schemas[tool.name] = {
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
		};
	}
	return schemas;
}

export function searchCatalog(
	entries: readonly DeferredCatalogEntry[],
	query: string,
	limit = DEFAULT_LIMIT,
): DeferredCatalogEntry[] {
	const cap = clampLimit(limit);
	const needle = query.trim().toLowerCase();
	if (!needle) return entries.slice(0, cap);

	return [...entries]
		.map((entry) => ({ entry, score: scoreEntry(entry, needle) }))
		.filter((row) => row.score > 0)
		.sort(
			(a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name),
		)
		.slice(0, cap)
		.map((row) => row.entry);
}

export function loadDeferredSchema(
	schemas: Record<string, DeferredSchemaEntry>,
	name: string,
): DeferredSchemaEntry | undefined {
	return schemas[name];
}

export function buildDeferredToolDefinitions(
	spec: RuahToolSchema,
): ToolDefinition[] {
	const hidden = spec.tools.length;
	const meta = (
		name: string,
		description: string,
		inputSchema: Record<string, unknown>,
	): ToolDefinition => ({
		name,
		description,
		inputSchema,
		_meta: {
			ruah: {
				risk: "safe",
				method: "GET",
				path: `/${name}`,
			},
		},
	});

	return [
		meta(
			DEFERRED_SEARCH,
			`Search ${hidden} API operations by name, path, or description. Returns compact matches — call ${DEFERRED_SCHEMA} for the full input schema, then ${DEFERRED_INVOKE} to run one.`,
			{
				type: "object",
				properties: {
					query: {
						type: "string",
						description:
							"Case-insensitive substring. Empty lists the first page.",
					},
					limit: {
						type: "integer",
						minimum: 1,
						maximum: MAX_LIMIT,
						description: `Max matches (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
					},
				},
			},
		),
		meta(
			DEFERRED_SCHEMA,
			`Load the full input schema for one operation from the ${hidden}-tool catalog.`,
			{
				type: "object",
				properties: {
					name: {
						type: "string",
						description: "Exact tool name from search_tools.",
					},
				},
				required: ["name"],
			},
		),
		meta(
			DEFERRED_INVOKE,
			`Invoke one API operation by name. Load its schema with ${DEFERRED_SCHEMA} first if you are unsure of the arguments.`,
			{
				type: "object",
				properties: {
					name: {
						type: "string",
						description: "Exact tool name from search_tools.",
					},
					arguments: {
						type: "object",
						additionalProperties: true,
						description: "Arguments matching that tool's input schema.",
					},
				},
				required: ["name"],
			},
		),
	];
}

export function truncateDescription(text: string, max: number): string {
	if (!Number.isFinite(max) || max <= 0 || text.length <= max) return text;
	if (max <= 1) return "…";
	return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function clampLimit(limit: number): number {
	if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
	return Math.min(MAX_LIMIT, Math.max(1, Math.round(limit)));
}

function scoreEntry(entry: DeferredCatalogEntry, needle: string): number {
	const name = entry.name.toLowerCase();
	const path = entry.path.toLowerCase();
	const description = entry.description.toLowerCase();
	if (name === needle) return 100;
	if (name.includes(needle)) return 80;
	if (path.includes(needle)) return 60;
	if (description.includes(needle)) return 40;
	const tokens = needle.split(/\s+/).filter(Boolean);
	return tokens.reduce((score, token) => {
		if (name.includes(token)) return score + 15;
		if (path.includes(token)) return score + 10;
		if (description.includes(token)) return score + 5;
		return score;
	}, 0);
}
