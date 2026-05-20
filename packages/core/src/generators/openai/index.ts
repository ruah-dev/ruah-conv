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
	// OpenAI tool definitions don't have a standard `_meta` slot. We mirror
	// the structured metadata under `function._meta.ruah` so callers that
	// inspect the JSON (e.g. policy engines) can still read risk/method/path
	// without parsing the description.
	transform: (spec) =>
		buildToolDefinitions(spec).map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.inputSchema,
				_meta: tool._meta,
			},
		})),
});

export const generate = generator.generate;
