import type { HttpMethod, Tool } from "../ir/schema.js";
import { estimateDefinitionTokens } from "./estimator.js";
import { endsWithPathParam, splitPath } from "./family.js";

/**
 * Deterministic rank for one operation. Documented in README:
 *
 * 1. CRUD verbs on a collection beat item writes
 * 2. Deep paths lose a point
 * 3. Wide parameter lists lose a point
 * 4. Deprecated operations are scored to the floor
 * 5. Frequent tags get a small boost (core resource signal)
 */
export function scoreTool(
	tool: Pick<Tool, "method" | "path" | "parameters" | "deprecated" | "tags">,
	tagFrequency: Map<string, number> = new Map(),
): number {
	if (tool.deprecated) return 0;

	const item = endsWithPathParam(tool.path);
	let score = methodScore(tool.method, item);

	const depth = splitPath(tool.path).length;
	if (depth > 4) score -= 1;

	if (tool.parameters.length > 6) score -= 1;

	if (tool.tags && tool.tags.length > 0 && tagFrequency.size > 0) {
		const maxFreq = Math.max(...tagFrequency.values());
		const boost = tool.tags.some((tag) => tagFrequency.get(tag) === maxFreq);
		if (boost && maxFreq >= 2) score += 1;
	}

	return score;
}

function methodScore(method: HttpMethod, item: boolean): number {
	switch (method) {
		case "GET":
			return item ? 8 : 10;
		case "POST":
			return item ? 5 : 7;
		case "PUT":
		case "PATCH":
			return 5;
		case "DELETE":
			return 4;
		case "HEAD":
		case "OPTIONS":
			return 3;
	}
}

export function buildTagFrequency(
	tools: ReadonlyArray<Pick<Tool, "tags">>,
): Map<string, number> {
	const freq = new Map<string, number>();
	for (const tool of tools) {
		for (const tag of tool.tags ?? []) {
			freq.set(tag, (freq.get(tag) ?? 0) + 1);
		}
	}
	return freq;
}

export function definitionPayload(
	tool: Pick<
		Tool,
		"name" | "method" | "path" | "parameters" | "requestBody" | "description"
	>,
): unknown {
	return {
		name: tool.name,
		description: tool.description,
		method: tool.method,
		path: tool.path,
		parameters: tool.parameters,
		requestBody: tool.requestBody,
	};
}

export function toolDefinitionTokens(
	tool: Pick<
		Tool,
		"name" | "method" | "path" | "parameters" | "requestBody" | "description"
	>,
): number {
	return estimateDefinitionTokens(definitionPayload(tool));
}
