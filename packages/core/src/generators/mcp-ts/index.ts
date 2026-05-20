// MCP tool definitions generator — JSON array of MCP-compatible tool defs.

import type { GeneratorCapability } from "../capability.js";
import { defineSimpleGenerator } from "../factory.js";
import { buildToolDefinitions } from "../shared.js";

export const capability: GeneratorCapability = {
	id: "mcp-tool-defs",
	label: "MCP Tool Definitions",
	emits: "json",
	supportsTransport: false,
	supportsName: false,
};

const generator = defineSimpleGenerator({
	capability,
	filename: "tools.json",
	transform: (spec) => buildToolDefinitions(spec),
});

export const generate = generator.generate;
