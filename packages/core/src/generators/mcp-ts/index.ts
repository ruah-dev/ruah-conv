// MCP tool definitions generator — produces a JSON array of MCP-compatible tool definitions.

import type { RuahToolSchema } from "../../ir/schema.js";
import type { GenerateResult } from "../index.js";
import { buildToolDefinitions } from "../shared.js";

export function generate(spec: RuahToolSchema): GenerateResult {
	const tools = buildToolDefinitions(spec);

	return {
		files: [
			{
				path: "tools.json",
				content: JSON.stringify(tools, null, 2),
				language: "json",
			},
		],
		summary: {
			toolCount: tools.length,
			typeCount: Object.keys(spec.types).length,
			targetId: "mcp-tool-defs",
			warnings: [],
		},
	};
}
