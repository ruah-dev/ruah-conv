// OpenAPI 3.0 / 3.1 → Ruah Tool Schema parser

import type {
	AuthSchema,
	HttpMethod,
	IRType,
	Parameter,
	RequestBody,
	ResponseSchema,
	RuahToolSchema,
	SchemaMeta,
	SourceFormat,
	Tool,
	TypeDefinition,
} from "../ir/schema.js";
import {
	deduplicateNames,
	normalizeToolName,
	synthesizeToolName,
} from "../naming/index.js";
import { getMethodFlags, inferPagination } from "./shared.js";

// ── Public API ───────────────────────────────────────────────────────

export function parseOpenAPI(
	filePath: string,
	doc: Record<string, unknown>,
): RuahToolSchema {
	const version = detectVersion(doc);
	const meta = extractMeta(filePath, doc, version);
	const auth = extractAuth(doc);
	const types = extractTypes(doc);
	const tools = extractTools(doc, auth, types);

	return { meta, auth, tools, types };
}

// ── Version detection ────────────────────────────────────────────────

function detectVersion(doc: Record<string, unknown>): SourceFormat {
	const v = String(doc.openapi ?? "");
	if (v.startsWith("3.1")) return "openapi-3.1";
	return "openapi-3.0";
}

// ── Metadata extraction ──────────────────────────────────────────────

function extractMeta(
	filePath: string,
	doc: Record<string, unknown>,
	version: SourceFormat,
): SchemaMeta {
	const info = (doc.info as Record<string, unknown>) ?? {};
	const servers = (doc.servers as Array<Record<string, unknown>>) ?? [];

	return {
		title: String(info.title ?? "Untitled API"),
		version: String(info.version ?? "0.0.0"),
		description: info.description ? String(info.description) : undefined,
		baseUrl: servers[0]?.url ? String(servers[0].url) : undefined,
		sourceFormat: version,
		sourceFile: filePath,
		generatedAt: new Date().toISOString(),
	};
}

// ── Auth extraction ──────────────────────────────────────────────────

function extractAuth(doc: Record<string, unknown>): AuthSchema[] {
	const components = (doc.components as Record<string, unknown>) ?? {};
	const schemes =
		(components.securitySchemes as Record<string, Record<string, unknown>>) ??
		{};
	const result: AuthSchema[] = [];

	for (const [id, scheme] of Object.entries(schemes)) {
		const type = String(scheme.type ?? "");
		const auth: AuthSchema = { id, type: normalizeAuthType(type) };

		if (type === "apiKey") {
			auth.in = scheme.in as AuthSchema["in"];
			auth.name = scheme.name ? String(scheme.name) : undefined;
		} else if (type === "http") {
			auth.scheme = scheme.scheme ? String(scheme.scheme) : undefined;
		}

		if (scheme.description) {
			auth.description = String(scheme.description);
		}

		result.push(auth);
	}

	return result;
}

function normalizeAuthType(type: string): AuthSchema["type"] {
	switch (type) {
		case "apiKey":
			return "apiKey";
		case "http":
			return "http";
		case "oauth2":
			return "oauth2";
		case "openIdConnect":
			return "openIdConnect";
		default:
			return "http";
	}
}

// ── Type extraction ──────────────────────────────────────────────────

function extractTypes(
	doc: Record<string, unknown>,
): Record<string, TypeDefinition> {
	const components = (doc.components as Record<string, unknown>) ?? {};
	const schemas =
		(components.schemas as Record<string, Record<string, unknown>>) ?? {};
	const types: Record<string, TypeDefinition> = {};

	for (const [name, schema] of Object.entries(schemas)) {
		types[name] = {
			name,
			description: schema.description ? String(schema.description) : undefined,
			type: convertSchema(schema),
		};
	}

	return types;
}

// ── Tool (operation) extraction ──────────────────────────────────────

const HTTP_METHODS: HttpMethod[] = [
	"GET",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
	"HEAD",
	"OPTIONS",
];

function extractTools(
	doc: Record<string, unknown>,
	auth: AuthSchema[],
	_types: Record<string, TypeDefinition>,
): Tool[] {
	const paths = (doc.paths as Record<string, Record<string, unknown>>) ?? {};
	const tools: Tool[] = [];
	const names: string[] = [];

	for (const [path, pathItem] of Object.entries(paths)) {
		const pathParams =
			(pathItem.parameters as Array<Record<string, unknown>>) ?? [];

		for (const method of HTTP_METHODS) {
			const operation = pathItem[method.toLowerCase()] as
				| Record<string, unknown>
				| undefined;
			if (!operation) continue;

			const opParams =
				(operation.parameters as Array<Record<string, unknown>>) ?? [];
			const mergedParams = mergeParameters(pathParams, opParams);

			const operationId = operation.operationId
				? String(operation.operationId)
				: undefined;
			const rawName = operationId
				? normalizeToolName(operationId)
				: synthesizeToolName(method, path);
			names.push(rawName);

			const description = String(
				operation.summary ?? operation.description ?? `${method} ${path}`,
			);

			const parameters = mergedParams.map(convertParameter);
			const requestBody = operation.requestBody
				? convertRequestBody(operation.requestBody as Record<string, unknown>)
				: undefined;
			const responses = extractResponses(
				(operation.responses as Record<string, Record<string, unknown>>) ?? {},
			);

			// Determine auth from operation security or global security
			const security = (operation.security ?? doc.security) as
				| Array<Record<string, string[]>>
				| undefined;
			const toolAuth = resolveToolAuth(security, auth);

			tools.push({
				name: rawName, // will be deduplicated below
				description,
				operationId,
				method,
				path,
				parameters,
				requestBody,
				responses,
				auth: toolAuth.length > 0 ? toolAuth : undefined,
				tags: operation.tags ? (operation.tags as string[]) : undefined,
				deprecated: operation.deprecated === true ? true : undefined,
				pagination: inferPagination(parameters),
				...getMethodFlags(method),
			});
		}
	}

	// Deduplicate names
	const deduped = deduplicateNames(names);
	for (let i = 0; i < tools.length; i++) {
		tools[i].name = deduped[i];
	}

	return tools;
}

// ── Parameter handling ───────────────────────────────────────────────

function mergeParameters(
	pathParams: Array<Record<string, unknown>>,
	opParams: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
	// Operation-level params override path-level by name+in
	const merged = new Map<string, Record<string, unknown>>();

	for (const p of pathParams) {
		const key = `${p.name}:${p.in}`;
		merged.set(key, p);
	}
	for (const p of opParams) {
		const key = `${p.name}:${p.in}`;
		merged.set(key, p);
	}

	return [...merged.values()];
}

function convertParameter(param: Record<string, unknown>): Parameter {
	return {
		name: String(param.name ?? ""),
		in: String(param.in ?? "query") as Parameter["in"],
		required: param.required === true,
		description: param.description ? String(param.description) : undefined,
		schema: param.schema
			? convertSchema(param.schema as Record<string, unknown>)
			: { kind: "unknown" },
		example: param.example,
	};
}

// ── Request body handling ────────────────────────────────────────────

function convertRequestBody(
	body: Record<string, unknown>,
): RequestBody | undefined {
	const content =
		(body.content as Record<string, Record<string, unknown>>) ?? {};

	// Prefer application/json
	const jsonContent = content["application/json"];
	if (jsonContent) {
		return {
			required: body.required === true,
			description: body.description ? String(body.description) : undefined,
			contentType: "application/json",
			schema: jsonContent.schema
				? convertSchema(jsonContent.schema as Record<string, unknown>)
				: { kind: "unknown" },
			example: jsonContent.example,
		};
	}

	// Fall back to first available content type
	const firstType = Object.keys(content)[0];
	if (firstType) {
		const firstContent = content[firstType];
		return {
			required: body.required === true,
			description: body.description ? String(body.description) : undefined,
			contentType: firstType,
			schema: firstContent.schema
				? convertSchema(firstContent.schema as Record<string, unknown>)
				: { kind: "unknown" },
			example: firstContent.example,
		};
	}

	return undefined;
}

// ── Response handling ────────────────────────────────────────────────

function extractResponses(
	responses: Record<string, Record<string, unknown>>,
): ResponseSchema[] {
	const result: ResponseSchema[] = [];

	for (const [statusCode, response] of Object.entries(responses)) {
		const content =
			(response.content as Record<string, Record<string, unknown>>) ?? {};
		const jsonContent = content["application/json"];

		result.push({
			statusCode,
			description: response.description
				? String(response.description)
				: undefined,
			contentType: jsonContent ? "application/json" : Object.keys(content)[0],
			schema: jsonContent?.schema
				? convertSchema(jsonContent.schema as Record<string, unknown>)
				: undefined,
		});
	}

	return result;
}

// ── Auth resolution ──────────────────────────────────────────────────

function resolveToolAuth(
	security: Array<Record<string, string[]>> | undefined,
	auth: AuthSchema[],
): string[] {
	if (!security || security.length === 0) return [];

	const ids: string[] = [];
	const authIds = new Set(auth.map((a) => a.id));

	for (const requirement of security) {
		for (const id of Object.keys(requirement)) {
			if (authIds.has(id)) {
				ids.push(id);
			}
		}
	}

	return [...new Set(ids)];
}

// ── Schema conversion (recursive) ───────────────────────────────────

export function convertSchema(schema: Record<string, unknown>): IRType {
	if (!schema || typeof schema !== "object") {
		return { kind: "unknown" };
	}

	const description = schema.description
		? String(schema.description)
		: undefined;
	const nullable = schema.nullable === true;

	// Handle $ref
	if (schema.$ref) {
		const ref = String(schema.$ref);
		const refName = ref.split("/").pop() ?? ref;
		return { kind: "ref", $ref: refName, description, nullable };
	}

	// Handle enum
	if (Array.isArray(schema.enum)) {
		return {
			kind: "enum",
			values: schema.enum as (string | number | boolean)[],
			description,
			nullable,
		};
	}

	// Handle oneOf / anyOf / allOf
	for (const composite of ["oneOf", "anyOf", "allOf"] as const) {
		if (Array.isArray(schema[composite])) {
			return {
				kind: composite,
				variants: (schema[composite] as Array<Record<string, unknown>>).map(
					convertSchema,
				),
				description,
				nullable,
			};
		}
	}

	// Handle type-based schemas
	const type = schema.type as string | string[] | undefined;

	// OpenAPI 3.1 type arrays (e.g., ["string", "null"])
	if (Array.isArray(type)) {
		const nonNull = type.filter((t) => t !== "null");
		const isNullable = type.includes("null");
		if (nonNull.length === 1) {
			return convertTypedSchema(nonNull[0], schema, description, isNullable);
		}
		// Multiple non-null types → anyOf
		return {
			kind: "anyOf",
			variants: nonNull.map((t) =>
				convertTypedSchema(t, schema, undefined, false),
			),
			description,
			nullable: isNullable,
		};
	}

	if (typeof type === "string") {
		return convertTypedSchema(type, schema, description, nullable);
	}

	// Has properties but no type — assume object
	if (schema.properties) {
		return convertTypedSchema("object", schema, description, nullable);
	}

	// Has items but no type — assume array
	if (schema.items) {
		return convertTypedSchema("array", schema, description, nullable);
	}

	return { kind: "unknown", description, nullable };
}

function convertTypedSchema(
	type: string,
	schema: Record<string, unknown>,
	description: string | undefined,
	nullable: boolean,
): IRType {
	switch (type) {
		case "string":
			return {
				kind: "string",
				format: schema.format ? String(schema.format) : undefined,
				pattern: schema.pattern ? String(schema.pattern) : undefined,
				description,
				nullable,
			};
		case "number":
		case "integer":
			return {
				kind: type,
				format: schema.format ? String(schema.format) : undefined,
				minimum:
					typeof schema.minimum === "number" ? schema.minimum : undefined,
				maximum:
					typeof schema.maximum === "number" ? schema.maximum : undefined,
				description,
				nullable,
			};
		case "boolean":
			return { kind: "boolean", description, nullable };
		case "object": {
			const properties: Record<string, { type: IRType; description?: string }> =
				{};
			const props =
				(schema.properties as Record<string, Record<string, unknown>>) ?? {};

			for (const [name, propSchema] of Object.entries(props)) {
				properties[name] = {
					type: convertSchema(propSchema),
					description: propSchema.description
						? String(propSchema.description)
						: undefined,
				};
			}

			let additionalProperties: boolean | IRType | undefined;
			if (schema.additionalProperties === false) {
				additionalProperties = false;
			} else if (
				schema.additionalProperties &&
				typeof schema.additionalProperties === "object"
			) {
				additionalProperties = convertSchema(
					schema.additionalProperties as Record<string, unknown>,
				);
			}

			return {
				kind: "object",
				properties,
				required: Array.isArray(schema.required)
					? (schema.required as string[])
					: [],
				additionalProperties,
				description,
				nullable,
			};
		}
		case "array":
			return {
				kind: "array",
				items: schema.items
					? convertSchema(schema.items as Record<string, unknown>)
					: { kind: "unknown" },
				description,
				nullable,
			};
		default:
			return { kind: "unknown", description, nullable };
	}
}
