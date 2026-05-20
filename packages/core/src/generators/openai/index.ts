import type { GeneratorCapability } from "../capability.js";
import { defineSimpleGenerator } from "../factory.js";
import { buildToolDefinitions } from "../shared.js";

export const capability: GeneratorCapability = {
	id: "openai-tools",
	label: "OpenAI Tools",
	emits: "json",
	supportsTransport: false,
	supportsName: false,
};

const generator = defineSimpleGenerator({
	capability,
	filename: "openai-tools.json",
	transform: (spec) =>
		buildToolDefinitions(spec).map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.inputSchema,
			},
		})),
});

export const generate = generator.generate;
