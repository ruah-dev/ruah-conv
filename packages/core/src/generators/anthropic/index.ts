import type { GeneratorCapability } from "../capability.js";
import { defineSimpleGenerator } from "../factory.js";
import { buildToolDefinitions } from "../shared.js";

export const capability: GeneratorCapability = {
	id: "anthropic-tools",
	label: "Anthropic Tools",
	emits: "json",
	supportsTransport: false,
	supportsName: false,
};

const generator = defineSimpleGenerator({
	capability,
	filename: "anthropic-tools.json",
	transform: (spec) =>
		buildToolDefinitions(spec).map((tool) => ({
			name: tool.name,
			description: tool.description,
			input_schema: tool.inputSchema,
		})),
});

export const generate = generator.generate;
