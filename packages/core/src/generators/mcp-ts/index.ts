// MCP tool definitions generator — JSON array of MCP-compatible tool defs.

import type { RuahToolSchema } from "../../ir/schema.js";
import type { GeneratorCapability } from "../capability.js";
import { buildDeferredToolDefinitions } from "../deferred.js";
import { defineSimpleGenerator } from "../factory.js";
import type { GenerateOptions, GenerateResult } from "../index.js";
import { buildToolDefinitions } from "../shared.js";

export const capability: GeneratorCapability = {
	id: "mcp-tool-defs",
	label: "MCP Tool Definitions",
	emits: "json",
	supportsTransport: false,
	supportsName: false,
	supportsDeferred: true,
};

const generator = defineSimpleGenerator({
	capability,
	filename: "tools.json",
	transform: (spec) => buildToolDefinitions(spec),
});

export function generate(
	spec: RuahToolSchema,
	options: GenerateOptions = {},
): GenerateResult {
	if (options.deferred) {
		const tools = buildDeferredToolDefinitions(spec);
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
				targetId: capability.id,
				warnings: [
					`deferred: ${spec.tools.length} operations behind search_tools / get_tool_schema / invoke_tool`,
				],
			},
		};
	}
	return generator.generate(spec);
}
