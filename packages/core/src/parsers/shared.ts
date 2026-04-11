import type { HttpMethod, PaginationInfo, Tool } from "../ir/schema.js";

export function classifyRisk(method: HttpMethod): Tool["riskLevel"] {
	switch (method) {
		case "GET":
		case "HEAD":
		case "OPTIONS":
			return "safe";
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

	const pageNumberParams = ["page", "pageindex"];
	const pageSizeParams = ["pagesize", "perpage", "per_page", "size"];
	const hasPageNumber = pageNumberParams.some((name) => queryNames.has(name));
	const hasPageSize = pageSizeParams.some((name) => queryNames.has(name));
	if (hasPageNumber || hasPageSize) {
		return {
			style: "page-number",
			params: [...queryNames].filter(
				(name) =>
					pageNumberParams.includes(name) || pageSizeParams.includes(name),
			),
		};
	}

	const cursorParams = ["cursor", "after", "before", "nextcursor", "nexttoken"];
	const matchedCursorParams = cursorParams.filter((name) =>
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
