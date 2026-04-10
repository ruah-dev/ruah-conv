import type {
	IRType,
	RuahToolSchema,
	ValidationWarning,
	WarningCode,
} from "./schema.js";

const MAX_TOOL_NAME_LENGTH = 64;

export function validateIR(spec: RuahToolSchema): ValidationWarning[] {
	const warnings: ValidationWarning[] = [];

	function warn(path: string, code: WarningCode, message: string): void {
		warnings.push({ path, code, message });
	}

	// Meta checks
	if (!spec.meta.baseUrl) {
		warn(
			"meta.baseUrl",
			"missing-base-url",
			"No base URL defined — generated tools will need a runtime base URL.",
		);
	}

	// No operations
	if (spec.tools.length === 0) {
		warn(
			"tools",
			"no-operations",
			"Spec has no operations — nothing to convert.",
		);
	}

	// Tool checks
	const nameCount = new Map<string, number>();
	for (const tool of spec.tools) {
		nameCount.set(tool.name, (nameCount.get(tool.name) ?? 0) + 1);
	}

	for (let i = 0; i < spec.tools.length; i++) {
		const tool = spec.tools[i];
		const prefix = `tools[${i}]`;

		if (!tool.description) {
			warn(
				`${prefix}.description`,
				"missing-description",
				`Tool "${tool.name}" has no description — LLMs need this to understand the tool.`,
			);
		}

		if (tool.name.length > MAX_TOOL_NAME_LENGTH) {
			warn(
				`${prefix}.name`,
				"long-tool-name",
				`Tool name "${tool.name}" exceeds ${MAX_TOOL_NAME_LENGTH} chars.`,
			);
		}

		if ((nameCount.get(tool.name) ?? 0) > 1) {
			warn(
				`${prefix}.name`,
				"duplicate-tool-name",
				`Duplicate tool name "${tool.name}".`,
			);
		}

		// Parameter checks
		for (let j = 0; j < tool.parameters.length; j++) {
			const param = tool.parameters[j];
			if (!param.description) {
				warn(
					`${prefix}.parameters[${j}]`,
					"missing-param-description",
					`Parameter "${param.name}" on tool "${tool.name}" has no description.`,
				);
			}
			checkType(`${prefix}.parameters[${j}].schema`, param.schema, spec, warn);
		}

		// Request body check
		if (tool.requestBody) {
			checkType(
				`${prefix}.requestBody.schema`,
				tool.requestBody.schema,
				spec,
				warn,
			);
		}

		// Response checks
		for (let j = 0; j < tool.responses.length; j++) {
			const resp = tool.responses[j];
			if (resp.schema) {
				checkType(`${prefix}.responses[${j}].schema`, resp.schema, spec, warn);
			}
		}
	}

	return warnings;
}

function checkType(
	path: string,
	type: IRType,
	spec: RuahToolSchema,
	warn: (path: string, code: WarningCode, message: string) => void,
): void {
	switch (type.kind) {
		case "unknown":
			warn(
				path,
				"unknown-type",
				"Type could not be determined — will be treated as any.",
			);
			break;
		case "ref":
			if (!spec.types[type.$ref]) {
				warn(
					path,
					"unresolved-ref",
					`Reference "${type.$ref}" not found in types map.`,
				);
			}
			break;
		case "object":
			for (const [propName, prop] of Object.entries(type.properties)) {
				checkType(`${path}.properties.${propName}`, prop.type, spec, warn);
			}
			break;
		case "array":
			checkType(`${path}.items`, type.items, spec, warn);
			break;
		case "oneOf":
		case "anyOf":
		case "allOf":
			for (let i = 0; i < type.variants.length; i++) {
				checkType(`${path}.variants[${i}]`, type.variants[i], spec, warn);
			}
			break;
	}
}
