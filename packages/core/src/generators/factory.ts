import type { RuahToolSchema } from "../ir/schema.js";
import type { GeneratorCapability } from "./capability.js";
import type { GenerateResult } from "./index.js";

export interface SimpleGeneratorDefinition<T> {
	capability: GeneratorCapability;
	transform: (spec: RuahToolSchema) => readonly T[];
	filename: string;
}

export interface SimpleGenerator {
	capability: GeneratorCapability;
	generate(spec: RuahToolSchema): GenerateResult;
}

/**
 * Build a generator that serializes a single JSON artifact derived from the
 * spec. Eliminates the boilerplate shared by the OpenAI, Anthropic, and
 * MCP-tool-defs targets.
 */
export function defineSimpleGenerator<T>(
	options: SimpleGeneratorDefinition<T>,
): SimpleGenerator {
	const { capability, transform, filename } = options;
	return {
		capability,
		generate(spec: RuahToolSchema): GenerateResult {
			const payload = transform(spec);
			return {
				files: [
					{
						path: filename,
						content: JSON.stringify(payload, null, 2),
						language: "json",
					},
				],
				summary: {
					toolCount: payload.length,
					typeCount: Object.keys(spec.types).length,
					targetId: capability.id,
					warnings: [],
				},
			};
		},
	};
}
