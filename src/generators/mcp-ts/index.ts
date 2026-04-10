// MCP tool definitions generator — produces JSON array of MCP-compatible tool definitions.

import type {
	IRType,
	RuahToolSchema,
	TypeDefinition,
} from "../../ir/schema.js";
import type { GenerateResult } from "../index.js";

export function generate(spec: RuahToolSchema): GenerateResult {
	const tools = spec.tools.map((tool) => {
		const properties: Record<string, unknown> = {};
		const required: string[] = [];

		// Path parameters
		for (const param of tool.parameters.filter((p) => p.in === "path")) {
			properties[param.name] = irTypeToJsonSchema(param.schema, spec.types);
			if (param.description) {
				(properties[param.name] as Record<string, unknown>).description =
					param.description;
			}
			required.push(param.name); // path params are always required
		}

		// Query parameters
		for (const param of tool.parameters.filter((p) => p.in === "query")) {
			properties[param.name] = irTypeToJsonSchema(param.schema, spec.types);
			if (param.description) {
				(properties[param.name] as Record<string, unknown>).description =
					param.description;
			}
			if (param.required) {
				required.push(param.name);
			}
		}

		// Header parameters (exposed as tool inputs)
		for (const param of tool.parameters.filter((p) => p.in === "header")) {
			properties[param.name] = irTypeToJsonSchema(param.schema, spec.types);
			if (param.description) {
				(properties[param.name] as Record<string, unknown>).description =
					param.description;
			}
			if (param.required) {
				required.push(param.name);
			}
		}

		// Request body
		if (tool.requestBody) {
			const bodySchema = irTypeToJsonSchema(
				tool.requestBody.schema,
				spec.types,
			);
			if (
				typeof bodySchema === "object" &&
				bodySchema !== null &&
				"properties" in bodySchema &&
				(bodySchema as Record<string, unknown>).type === "object"
			) {
				// Flatten body properties into top-level for cleaner tool interface
				const bodyProps =
					((bodySchema as Record<string, unknown>).properties as Record<
						string,
						unknown
					>) ?? {};
				const bodyRequired =
					((bodySchema as Record<string, unknown>).required as string[]) ?? [];
				Object.assign(properties, bodyProps);
				if (tool.requestBody.required) {
					required.push(...bodyRequired);
				}
			} else {
				// Non-object body goes under "body" key
				properties.body = bodySchema;
				if (tool.requestBody.description) {
					(properties.body as Record<string, unknown>).description =
						tool.requestBody.description;
				}
				if (tool.requestBody.required) {
					required.push("body");
				}
			}
		}

		const inputSchema: Record<string, unknown> = {
			type: "object",
			properties,
		};

		if (required.length > 0) {
			inputSchema.required = required;
		}

		const toolDef: Record<string, unknown> = {
			name: tool.name,
			description: tool.description,
			inputSchema,
		};

		return toolDef;
	});

	const content = JSON.stringify(tools, null, 2);

	return {
		files: [
			{
				path: "tools.json",
				content,
				language: "json",
			},
		],
		summary: {
			toolCount: tools.length,
			typeCount: Object.keys(spec.types).length,
			targetId: "mcp-tool-defs",
			warnings: [],
		},
	};
}

// ── IR Type → JSON Schema conversion ─────────────────────────────────

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
			// Resolve the reference, with cycle detection
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
				[type.kind]: type.variants.map((v) =>
					irTypeToJsonSchema(v, types, visited),
				),
			};
			if (type.description) schema.description = type.description;
			return schema;
		}

		case "allOf": {
			// Merge allOf into a single object for JSON Schema
			const schema: Record<string, unknown> = {
				allOf: type.variants.map((v) => irTypeToJsonSchema(v, types, visited)),
			};
			if (type.description) schema.description = type.description;
			return schema;
		}

		case "unknown":
			return type.description ? { description: type.description } : {};
	}
}
