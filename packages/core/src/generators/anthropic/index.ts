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
	// The Anthropic tool definition wire format only allows name/description/
	// input_schema. We attach the structured metadata as a top-level `_meta`
	// extension so downstream tooling can read it; the Anthropic API will
	// ignore unknown fields when the tools are passed through.
	transform: (spec) =>
		buildToolDefinitions(spec).map((tool) => ({
			name: tool.name,
			description: tool.description,
			input_schema: tool.inputSchema,
			_meta: tool._meta,
		})),
});

export const generate = generator.generate;
