import type {
	PaginationConfig,
	PaginationOperationOverride,
} from "../config.js";
import type {
	HttpMethod,
	PaginationInfo,
	RuahToolSchema,
	Tool,
} from "../ir/schema.js";

export function classifyRisk(method: HttpMethod): Tool["riskLevel"] {
	switch (method) {
		case "GET":
		case "HEAD":
		case "OPTIONS":
			return "safe";
		case "PATCH":
		case "DELETE":
			return "destructive";
		default:
			return "moderate";
	}
}

export function getMethodFlags(
	method: HttpMethod,
): Pick<Tool, "idempotent" | "readOnly" | "riskLevel"> {
	return {
		idempotent:
			method === "GET" ||
			method === "PUT" ||
			method === "DELETE" ||
			method === "HEAD" ||
			method === "OPTIONS",
		readOnly: method === "GET" || method === "HEAD" || method === "OPTIONS",
		riskLevel: classifyRisk(method),
	};
}

const DEFAULT_OFFSET_PARAMS = ["offset"];
const DEFAULT_LIMIT_PARAMS = ["limit"];
const DEFAULT_PAGE_NUMBER_PARAMS = ["page", "pageindex"];
const DEFAULT_PAGE_SIZE_PARAMS = ["pagesize", "perpage", "per_page", "size"];
const DEFAULT_CURSOR_PARAMS = [
	"cursor",
	"after",
	"before",
	"nextcursor",
	"nexttoken",
];

export function inferPagination(
	params: Array<{ in: string; name: string }>,
): PaginationInfo | undefined {
	const queryNames = new Set(
		params
			.filter((param) => param.in === "query")
			.map((param) => param.name.toLowerCase()),
	);

	if (queryNames.has("limit") && queryNames.has("offset")) {
		return { style: "offset-limit", params: ["limit", "offset"] };
	}

	const hasPageNumber = DEFAULT_PAGE_NUMBER_PARAMS.some((name) =>
		queryNames.has(name),
	);
	const hasPageSize = DEFAULT_PAGE_SIZE_PARAMS.some((name) =>
		queryNames.has(name),
	);
	if (hasPageNumber || hasPageSize) {
		return {
			style: "page-number",
			params: [...queryNames].filter(
				(name) =>
					DEFAULT_PAGE_NUMBER_PARAMS.includes(name) ||
					DEFAULT_PAGE_SIZE_PARAMS.includes(name),
			),
		};
	}

	const matchedCursorParams = DEFAULT_CURSOR_PARAMS.filter((name) =>
		queryNames.has(name),
	);
	if (matchedCursorParams.length > 0) {
		return {
			style: "cursor",
			params: matchedCursorParams,
		};
	}

	return undefined;
}

function lowercaseList(values: string[] | undefined): string[] {
	return values ? values.map((value) => value.toLowerCase()) : [];
}

function pickParam(tool: Tool, candidates: string[]): string | undefined {
	if (candidates.length === 0) return undefined;
	const wanted = new Set(candidates.map((name) => name.toLowerCase()));
	for (const param of tool.parameters) {
		if (param.in === "query" && wanted.has(param.name.toLowerCase())) {
			return param.name;
		}
	}
	return undefined;
}

function applyDefaults(
	tool: Tool,
	defaults: NonNullable<PaginationConfig["defaults"]>,
): PaginationInfo | undefined {
	const offsetExtras = lowercaseList(defaults.offsetParams);
	const limitExtras = lowercaseList(defaults.limitParams);
	const pageExtras = lowercaseList(defaults.pageParams);
	const pageSizeExtras = lowercaseList(defaults.pageSizeParams);
	const cursorExtras = lowercaseList(defaults.cursorParams);

	const queryParams = tool.parameters
		.filter((param) => param.in === "query")
		.map((param) => ({
			original: param.name,
			lower: param.name.toLowerCase(),
		}));
	const queryNamesLower = new Set(queryParams.map((p) => p.lower));

	const offsetCandidates = new Set([...DEFAULT_OFFSET_PARAMS, ...offsetExtras]);
	const limitCandidates = new Set([...DEFAULT_LIMIT_PARAMS, ...limitExtras]);
	const matchedOffset = queryParams.find((p) => offsetCandidates.has(p.lower));
	const matchedLimit = queryParams.find((p) => limitCandidates.has(p.lower));
	if (matchedOffset && matchedLimit) {
		return {
			style: "offset-limit",
			params: [matchedLimit.original, matchedOffset.original],
		};
	}

	const pageCandidates = new Set([
		...DEFAULT_PAGE_NUMBER_PARAMS,
		...pageExtras,
	]);
	const pageSizeCandidates = new Set([
		...DEFAULT_PAGE_SIZE_PARAMS,
		...pageSizeExtras,
	]);
	const pageMatches = queryParams.filter(
		(p) => pageCandidates.has(p.lower) || pageSizeCandidates.has(p.lower),
	);
	if (pageMatches.length > 0) {
		return {
			style: "page-number",
			params: pageMatches.map((p) => p.original),
		};
	}

	const cursorCandidates = new Set([...DEFAULT_CURSOR_PARAMS, ...cursorExtras]);
	const cursorMatches = queryParams.filter((p) =>
		cursorCandidates.has(p.lower),
	);
	if (cursorMatches.length > 0) {
		return {
			style: "cursor",
			params: cursorMatches.map((p) => p.original),
		};
	}

	// No defaults matched; fall back to heuristic which was already applied,
	// but the caller treats `undefined` here as "no defaults change".
	void queryNamesLower;
	return undefined;
}

function applyOperationOverride(
	tool: Tool,
	override: PaginationOperationOverride,
): PaginationInfo | undefined {
	const params: string[] = [];
	let inferredStyle: PaginationInfo["style"] | undefined = override.style;

	const offsetMatch = override.offsetParam
		? pickParam(tool, [override.offsetParam])
		: undefined;
	const limitMatch = override.limitParam
		? pickParam(tool, [override.limitParam])
		: undefined;
	const pageMatch = override.pageParam
		? pickParam(tool, [override.pageParam])
		: undefined;
	const pageSizeMatch = override.pageSizeParam
		? pickParam(tool, [override.pageSizeParam])
		: undefined;
	const cursorMatch = override.cursorParam
		? pickParam(tool, [override.cursorParam])
		: undefined;

	if (offsetMatch || limitMatch) {
		inferredStyle = inferredStyle ?? "offset-limit";
		if (limitMatch) params.push(limitMatch);
		if (offsetMatch) params.push(offsetMatch);
	} else if (pageMatch || pageSizeMatch) {
		inferredStyle = inferredStyle ?? "page-number";
		if (pageMatch) params.push(pageMatch);
		if (pageSizeMatch) params.push(pageSizeMatch);
	} else if (cursorMatch) {
		inferredStyle = inferredStyle ?? "cursor";
		params.push(cursorMatch);
	}

	if (!inferredStyle) {
		return undefined;
	}

	return { style: inferredStyle, params };
}

/**
 * Apply user-supplied pagination configuration to an already-parsed IR.
 *
 * - `defaults` extends the heuristic match set with extra param-name hints.
 * - `byOperation` fully overrides the heuristic for the named tool.
 *
 * Returns a new IR; the input is not mutated. If no config is provided the
 * input IR is returned unchanged.
 */
export function applyPaginationOverrides(
	spec: RuahToolSchema,
	config: PaginationConfig | undefined,
): RuahToolSchema {
	if (!config) return spec;
	const hasOverrides =
		(config.byOperation && Object.keys(config.byOperation).length > 0) ||
		(config.defaults && Object.values(config.defaults).some(Boolean));
	if (!hasOverrides) return spec;

	const byOperation = config.byOperation ?? {};
	const defaults = config.defaults;

	const nextTools = spec.tools.map((tool) => {
		const override = byOperation[tool.name];
		if (override) {
			const next = applyOperationOverride(tool, override);
			return next
				? { ...tool, pagination: next }
				: { ...tool, pagination: undefined };
		}
		if (defaults && !tool.pagination) {
			const next = applyDefaults(tool, defaults);
			if (next) {
				return { ...tool, pagination: next };
			}
		}
		return tool;
	});

	return { ...spec, tools: nextTools };
}

export function normalizeMethod(value: string | undefined): HttpMethod {
	switch (String(value ?? "").toUpperCase()) {
		case "GET":
		case "POST":
		case "PUT":
		case "PATCH":
		case "DELETE":
		case "HEAD":
		case "OPTIONS":
			return String(value).toUpperCase() as HttpMethod;
		default:
			return "POST";
	}
}

export function sanitizeDescription(
	description: string | undefined,
	fallback: string,
): string {
	const trimmed = description?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : fallback;
}
