import type {
	IRType,
	RequestBody,
	RuahToolSchema,
	Tool,
	TypeDefinition,
} from "../ir/schema.js";

export interface ToolSchemaResult {
	schema: Record<string, unknown>;
	flattenedBody: boolean;
}

export function buildToolInputSchema(
	tool: Tool,
	spec: RuahToolSchema,
): ToolSchemaResult {
	const properties: Record<string, unknown> = {};
	const required = new Set<string>();

	for (const param of tool.parameters) {
		properties[param.name] = irTypeToJsonSchema(param.schema, spec.types);
		if (param.description) {
			(properties[param.name] as Record<string, unknown>).description =
				param.description;
		}
		if (param.required || param.in === "path") {
			required.add(param.name);
		}
	}

	let flattenedBody = false;
	if (tool.requestBody && !shouldSkipRequestBodyInToolSchema(tool)) {
		flattenedBody = appendRequestBodySchema(
			properties,
			required,
			tool.requestBody,
			spec.types,
		);
	}

	const schema: Record<string, unknown> = {
		type: "object",
		properties,
	};

	if (required.size > 0) {
		schema.required = [...required];
	}

	return { schema, flattenedBody };
}

export function buildToolDefinitions(spec: RuahToolSchema): Array<{
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}> {
	return spec.tools.map((tool) => ({
		name: tool.name,
		description: enrichToolDescription(tool),
		inputSchema: buildToolInputSchema(tool, spec).schema,
	}));
}

export function buildOperationSpecs(spec: RuahToolSchema) {
	return spec.tools.map((tool) => ({
		name: tool.name,
		description: enrichToolDescription(tool),
		method: tool.method,
		path: tool.path,
		parameters: tool.parameters.map((param) => ({
			name: param.name,
			in: param.in,
			required: param.required || param.in === "path",
		})),
		requestBody: buildRequestBodyMeta(tool.requestBody),
	}));
}

export function enrichToolDescription(tool: Tool): string {
	const parts = [tool.description];
	if (tool.pagination) {
		parts.push(
			`Pagination: ${tool.pagination.style} via ${tool.pagination.params.join(", ")}.`,
		);
	}
	if (tool.riskLevel !== "safe") {
		parts.push(`Risk: ${tool.riskLevel}.`);
	}
	return parts.join(" ");
}

function appendRequestBodySchema(
	properties: Record<string, unknown>,
	required: Set<string>,
	requestBody: RequestBody,
	types: Record<string, TypeDefinition>,
): boolean {
	const bodySchema = irTypeToJsonSchema(requestBody.schema, types);
	if (
		typeof bodySchema === "object" &&
		bodySchema !== null &&
		(bodySchema as Record<string, unknown>).type === "object" &&
		"properties" in bodySchema
	) {
		const bodyProps =
			((bodySchema as Record<string, unknown>).properties as Record<
				string,
				unknown
			>) ?? {};
		const bodyRequired =
			((bodySchema as Record<string, unknown>).required as string[]) ?? [];
		Object.assign(properties, bodyProps);
		if (requestBody.required) {
			for (const key of bodyRequired) {
				required.add(key);
			}
		}
		return true;
	}

	properties.body = bodySchema;
	if (requestBody.description) {
		(properties.body as Record<string, unknown>).description =
			requestBody.description;
	}
	if (requestBody.required) {
		required.add("body");
	}
	return false;
}

function buildRequestBodyMeta(requestBody: RequestBody | undefined) {
	if (!requestBody) {
		return undefined;
	}

	return {
		required: requestBody.required,
		contentType: requestBody.contentType,
		schema: requestBody.schema,
	};
}

function shouldSkipRequestBodyInToolSchema(tool: Tool): boolean {
	return (
		tool.path === "/graphql" &&
		tool.requestBody?.contentType === "application/json" &&
		tool.parameters.length > 0
	);
}

export function irTypeToJsonSchema(
	type: IRType,
	types: Record<string, TypeDefinition>,
	visited: Set<string> = new Set(),
): Record<string, unknown> {
	switch (type.kind) {
		case "string":
		case "number":
		case "integer":
		case "boolean": {
			const schema: Record<string, unknown> = { type: type.kind };
			if (type.kind === "string") {
				if (type.format) schema.format = type.format;
				if (type.pattern) schema.pattern = type.pattern;
			}
			if (type.kind === "number" || type.kind === "integer") {
				if (type.minimum !== undefined) schema.minimum = type.minimum;
				if (type.maximum !== undefined) schema.maximum = type.maximum;
			}
			if (type.description) schema.description = type.description;
			return schema;
		}

		case "object": {
			const properties: Record<string, unknown> = {};
			for (const [name, prop] of Object.entries(type.properties)) {
				const propSchema = irTypeToJsonSchema(prop.type, types, visited);
				if (prop.description) {
					(propSchema as Record<string, unknown>).description =
						prop.description;
				}
				properties[name] = propSchema;
			}

			const schema: Record<string, unknown> = {
				type: "object",
				properties,
			};
			if (type.required.length > 0) {
				schema.required = type.required;
			}
			if (type.additionalProperties === false) {
				schema.additionalProperties = false;
			} else if (type.additionalProperties === true) {
				schema.additionalProperties = true;
			} else if (type.additionalProperties) {
				schema.additionalProperties = irTypeToJsonSchema(
					type.additionalProperties,
					types,
					visited,
				);
			}
			if (type.description) schema.description = type.description;
			return schema;
		}

		case "array": {
			const schema: Record<string, unknown> = {
				type: "array",
				items: irTypeToJsonSchema(type.items, types, visited),
			};
			if (type.description) schema.description = type.description;
			return schema;
		}

		case "ref": {
			if (visited.has(type.$ref)) {
				return {
					type: "object",
					description: `(circular reference: ${type.$ref})`,
				};
			}
			const typeDef = types[type.$ref];
			if (!typeDef) {
				return {
					type: "object",
					description: `(unresolved reference: ${type.$ref})`,
				};
			}
			const newVisited = new Set(visited);
			newVisited.add(type.$ref);
			return irTypeToJsonSchema(typeDef.type, types, newVisited);
		}

		case "enum": {
			const schema: Record<string, unknown> = { enum: type.values };
			if (type.description) schema.description = type.description;
			return schema;
		}

		case "oneOf":
		case "anyOf": {
			const schema: Record<string, unknown> = {
				[type.kind]: type.variants.map((variant) =>
					irTypeToJsonSchema(variant, types, visited),
				),
			};
			if (type.description) schema.description = type.description;
			return schema;
		}

		case "allOf": {
			const schema: Record<string, unknown> = {
				allOf: type.variants.map((variant) =>
					irTypeToJsonSchema(variant, types, visited),
				),
			};
			if (type.description) schema.description = type.description;
			return schema;
		}

		case "unknown":
			return type.description ? { description: type.description } : {};
	}
}
