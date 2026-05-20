import { basename } from "node:path";
import type {
	IRObject,
	IRType,
	Parameter,
	RequestBody,
	RuahToolSchema,
	TypeDefinition,
	ValidationWarning,
} from "../ir/schema.js";
import { normalizeToolName } from "../naming/index.js";
import { getMethodFlags } from "./shared.js";

interface ParseContext {
	warnings: ValidationWarning[];
}

const BUILTIN_SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID"]);

export function parseGraphQLSDL(
	filePath: string,
	content: string,
): RuahToolSchema {
	const sanitized = stripComments(content);
	const ctx: ParseContext = { warnings: [] };

	detectUnsupportedKeywords(sanitized, ctx);

	const typeDefinitions = extractTypeDefinitions(sanitized, ctx);
	const tools = [
		...extractOperationTools("Query", "GET", typeDefinitions, ctx),
		...extractOperationTools("Mutation", "POST", typeDefinitions, ctx),
	];

	// Flag dangling refs that aren't built-ins and aren't defined in this SDL —
	// validateIR will still emit `unresolved-ref`, but a graphql-specific note
	// helps the user understand the source.
	flagDanglingRefs(typeDefinitions, ctx);

	return {
		meta: {
			title: basename(filePath),
			version: "1.0.0",
			description: "Generated from GraphQL SDL",
			baseUrl: "/graphql",
			sourceFormat: "graphql-sdl",
			sourceFile: filePath,
			generatedAt: new Date().toISOString(),
		},
		auth: [],
		tools,
		types: typeDefinitions,
		parserWarnings: ctx.warnings.length > 0 ? ctx.warnings : undefined,
	};
}

function detectUnsupportedKeywords(content: string, ctx: ParseContext): void {
	const unionRegex = /^\s*union\s+([A-Za-z_]\w*)/gm;
	for (const match of content.matchAll(unionRegex)) {
		ctx.warnings.push({
			path: `types.${match[1]}`,
			code: "unsupported-graphql-type",
			message: `Union type "${match[1]}" is not supported by the GraphQL parser — references will be left as unresolved.`,
		});
	}

	const interfaceRegex = /^\s*interface\s+([A-Za-z_]\w*)/gm;
	for (const match of content.matchAll(interfaceRegex)) {
		ctx.warnings.push({
			path: `types.${match[1]}`,
			code: "unsupported-graphql-type",
			message: `Interface type "${match[1]}" is not supported by the GraphQL parser — references will be left as unresolved.`,
		});
	}
}

function flagDanglingRefs(
	types: Record<string, TypeDefinition>,
	ctx: ParseContext,
): void {
	const knownNames = new Set(Object.keys(types));
	const reported = new Set<string>();

	function walk(path: string, type: IRType): void {
		if (type.kind === "ref") {
			const name = type.$ref;
			if (
				!BUILTIN_SCALARS.has(name) &&
				!knownNames.has(name) &&
				!reported.has(name)
			) {
				reported.add(name);
				ctx.warnings.push({
					path,
					code: "unsupported-graphql-type",
					message: `GraphQL type "${name}" referenced at ${path} is not defined in this SDL — emitted as unresolved ref.`,
				});
			}
			return;
		}
		if (type.kind === "object") {
			for (const [propName, prop] of Object.entries(type.properties)) {
				walk(`${path}.${propName}`, prop.type);
			}
			return;
		}
		if (type.kind === "array") {
			walk(`${path}[]`, type.items);
		}
	}

	for (const [name, def] of Object.entries(types)) {
		walk(`types.${name}`, def.type);
	}
}

function extractTypeDefinitions(
	content: string,
	ctx: ParseContext,
): Record<string, TypeDefinition> {
	const types: Record<string, TypeDefinition> = {};

	for (const scalarName of matchAll(content, /^\s*scalar\s+([A-Za-z_]\w*)/gm)) {
		types[scalarName] = {
			name: scalarName,
			type: mapScalarToIR(scalarName),
		};
	}

	const enumRegex = /^\s*enum\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/gm;
	for (const match of content.matchAll(enumRegex)) {
		const name = match[1];
		const values = match[2]
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		types[name] = {
			name,
			type: {
				kind: "enum",
				values,
			},
		};
	}

	const objectRegex = /^\s*(type|input)\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/gm;
	for (const match of content.matchAll(objectRegex)) {
		const kind = match[1];
		const name = match[2];
		if (name === "Subscription") {
			continue;
		}
		types[name] = {
			name,
			type: parseObjectLikeDefinition(kind, name, match[3], ctx),
		};
	}

	return types;
}

function extractOperationTools(
	rootTypeName: "Query" | "Mutation",
	method: "GET" | "POST",
	types: Record<string, TypeDefinition>,
	_ctx: ParseContext,
) {
	const root = types[rootTypeName];
	if (!root || root.type.kind !== "object") {
		return [];
	}

	return Object.entries(root.type.properties).map(([name, prop]) => {
		const field = prop.type as IRObject & {
			arguments?: Parameter[];
			returnType?: IRType;
		};
		const parameters = field.arguments ?? [];
		const requestBody =
			method === "POST" ? buildMutationRequestBody(parameters) : undefined;
		return {
			name: normalizeToolName(name),
			description: `${rootTypeName} ${name}`,
			method,
			path: "/graphql",
			parameters,
			requestBody,
			responses: field.returnType
				? [
						{
							statusCode: "200",
							contentType: "application/json",
							schema: field.returnType,
						},
					]
				: [],
			tags: [rootTypeName.toLowerCase()],
			...getMethodFlags(method),
		};
	});
}

function buildMutationRequestBody(parameters: Parameter[]): RequestBody {
	return {
		required: true,
		contentType: "application/json",
		schema: {
			kind: "object",
			properties: {
				query: { type: { kind: "string" } },
				variables: {
					type: {
						kind: "object",
						properties: Object.fromEntries(
							parameters.map((param) => [param.name, { type: param.schema }]),
						),
						required: parameters
							.filter((param) => param.required)
							.map((param) => param.name),
					},
				},
			},
			required: ["query"],
		},
	};
}

function parseObjectLikeDefinition(
	kind: string,
	ownerName: string,
	body: string,
	ctx: ParseContext,
): IRObject {
	const properties: IRObject["properties"] = {};
	const required: string[] = [];

	for (const rawLine of body.split("\n")) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}

		const fieldMatch = line.match(
			/^([A-Za-z_]\w*)\s*(\(([^)]*)\))?\s*:\s*([![\]A-Za-z_][![\]A-Za-z_0-9]*)/,
		);
		if (!fieldMatch) {
			ctx.warnings.push({
				path: `types.${ownerName}`,
				code: "unsupported-graphql-type",
				message: `Unparseable field in "${ownerName}": "${line}" — skipped.`,
			});
			continue;
		}

		const [, fieldName, , argsGroup, typeRef] = fieldMatch;
		const type = graphQLTypeToIR(typeRef);
		properties[fieldName] = { type };

		if (typeRef.endsWith("!")) {
			required.push(fieldName);
		}

		if (kind === "type" && argsGroup !== undefined) {
			const metadata = properties[fieldName].type as IRType & {
				arguments?: Parameter[];
				returnType?: IRType;
			};
			metadata.arguments = parseArguments(argsGroup, ownerName, fieldName, ctx);
			metadata.returnType = graphQLTypeToIR(typeRef);
		}
	}

	return {
		kind: "object",
		properties,
		required,
	};
}

function parseArguments(
	argsGroup: string,
	ownerName: string,
	fieldName: string,
	ctx: ParseContext,
): Parameter[] {
	return splitTopLevel(argsGroup, ",")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const match = entry.match(
				/^([A-Za-z_]\w*)\s*:\s*([![\]A-Za-z_][![\]A-Za-z_0-9]*)/,
			);
			if (!match) {
				ctx.warnings.push({
					path: `types.${ownerName}.${fieldName}.arguments`,
					code: "unsupported-graphql-type",
					message: `Could not parse argument "${entry}" on field "${ownerName}.${fieldName}" — emitted as unknown.`,
				});
				return {
					name: "arg",
					in: "query" as const,
					required: false,
					schema: { kind: "unknown" } as IRType,
				};
			}
			const [, name, typeRef] = match;
			return {
				name,
				in: "query" as const,
				required: typeRef.endsWith("!"),
				schema: graphQLTypeToIR(typeRef),
			};
		});
}

function graphQLTypeToIR(typeRef: string): IRType {
	const trimmed = typeRef.trim();
	const nonNull = trimmed.endsWith("!");
	const base = nonNull ? trimmed.slice(0, -1) : trimmed;

	if (base.startsWith("[") && base.endsWith("]")) {
		return {
			kind: "array",
			items: graphQLTypeToIR(base.slice(1, -1)),
			nullable: !nonNull,
		};
	}

	if (["String", "ID"].includes(base)) {
		return { kind: "string", nullable: !nonNull };
	}
	if (base === "Int") {
		return { kind: "integer", nullable: !nonNull };
	}
	if (base === "Float") {
		return { kind: "number", nullable: !nonNull };
	}
	if (base === "Boolean") {
		return { kind: "boolean", nullable: !nonNull };
	}

	return { kind: "ref", $ref: base, nullable: !nonNull };
}

function mapScalarToIR(name: string): IRType {
	switch (name) {
		case "ID":
		case "String":
			return { kind: "string" };
		case "Int":
			return { kind: "integer" };
		case "Float":
			return { kind: "number" };
		case "Boolean":
			return { kind: "boolean" };
		default:
			return { kind: "string", description: `Custom scalar ${name}` };
	}
}

function matchAll(content: string, pattern: RegExp): string[] {
	return [...content.matchAll(pattern)].map((match) => match[1]);
}

function stripComments(content: string): string {
	return content.replace(/#[^\n]*/g, "");
}

function splitTopLevel(input: string, separator: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";

	for (const char of input) {
		if (char === "[" || char === "(") {
			depth += 1;
		}
		if (char === "]" || char === ")") {
			depth -= 1;
		}
		if (char === separator && depth === 0) {
			parts.push(current);
			current = "";
			continue;
		}
		current += char;
	}

	if (current.trim()) {
		parts.push(current);
	}

	return parts;
}
