// Tool naming policy — converts operationIds and paths into clean tool names.

/**
 * Normalize an operationId into a clean camelCase tool name.
 * e.g. "list-pets" → "listPets", "get_user_by_id" → "getUserById"
 */
export function normalizeToolName(operationId: string): string {
	// Strip common redundant prefixes
	const name = operationId
		.replace(/^api[_\-./]*/i, "")
		.replace(/^v\d+[_\-./]*/i, "");

	// Split on non-alphanumeric boundaries
	const parts = name.split(/[^a-zA-Z0-9]+/).filter(Boolean);
	if (parts.length === 0) return "unknownTool";

	// camelCase: first part lowercase, rest title-cased
	return parts
		.map((part, i) => {
			if (i === 0) return part.charAt(0).toLowerCase() + part.slice(1);
			return part.charAt(0).toUpperCase() + part.slice(1);
		})
		.join("");
}

/**
 * Synthesize a tool name from HTTP method + path when no operationId exists.
 * e.g. GET /pets/{petId} → "getPetsPetId"
 */
export function synthesizeToolName(method: string, path: string): string {
	const segments = path
		.split("/")
		.filter(Boolean)
		.map((seg) => {
			// Strip path parameter braces: {petId} → petId
			if (seg.startsWith("{") && seg.endsWith("}")) {
				return seg.slice(1, -1);
			}
			return seg;
		});

	const parts = [method.toLowerCase(), ...segments];

	return parts
		.map((part, i) => {
			// Split on non-alphanumeric within each part too
			const subParts = part.split(/[^a-zA-Z0-9]+/).filter(Boolean);
			return subParts
				.map((sub, j) => {
					if (i === 0 && j === 0) return sub.toLowerCase();
					return sub.charAt(0).toUpperCase() + sub.slice(1);
				})
				.join("");
		})
		.join("");
}

/**
 * Deduplicate a list of tool names by appending numeric suffixes.
 * Returns a new array with the same length, duplicates renamed.
 */
export function deduplicateNames(names: string[]): string[] {
	const counts = new Map<string, number>();
	const result: string[] = [];

	for (const name of names) {
		const count = counts.get(name) ?? 0;
		counts.set(name, count + 1);

		if (count === 0) {
			result.push(name);
		} else {
			result.push(`${name}${count + 1}`);
		}
	}

	return result;
}
