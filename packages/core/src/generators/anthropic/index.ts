import type { RuahToolSchema } from "../../ir/schema.js";
import type { GenerateResult } from "../index.js";
import { buildToolDefinitions } from "../shared.js";

export function generate(spec: RuahToolSchema): GenerateResult {
	const tools = buildToolDefinitions(spec).map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.inputSchema,
	}));

	return {
		files: [
			{
				path: "anthropic-tools.json",
				content: JSON.stringify(tools, null, 2),
				language: "json",
			},
		],
		summary: {
			toolCount: tools.length,
			typeCount: Object.keys(spec.types).length,
			targetId: "anthropic-tools",
			warnings: [],
		},
	};
}
