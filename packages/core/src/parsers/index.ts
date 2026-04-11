// Parser registry — auto-detect format and dispatch to the right parser.

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { RuahToolSchema, SourceFormat } from "../ir/schema.js";
import { parseGraphQLSDL } from "./graphql.js";
import { parseOpenAPI } from "./openapi.js";
import { parsePostmanCollection } from "./postman.js";
import { parseSwagger } from "./swagger.js";

export interface ParserInfo {
	id: string;
	name: string;
	formats: string[];
}

/**
 * Detect the spec format from file content.
 * Returns null if the format is not recognized.
 */
export function detectFormat(
	content: string,
	filePath?: string,
): SourceFormat | null {
	let doc: Record<string, unknown>;

	try {
		doc = JSON.parse(content) as Record<string, unknown>;
	} catch {
		try {
			doc = parseYaml(content) as Record<string, unknown>;
		} catch {
			return detectGraphQLSDL(content, filePath) ? "graphql-sdl" : null;
		}
	}

	const openapi = doc.openapi;
	if (typeof openapi === "string") {
		if (openapi.startsWith("3.1")) return "openapi-3.1";
		if (openapi.startsWith("3.0")) return "openapi-3.0";
	}

	if (String(doc.swagger ?? "") === "2.0") {
		return "swagger-2.0";
	}

	const postmanSchema = String(
		(doc.info as Record<string, unknown> | undefined)?.schema ?? "",
	);
	if (postmanSchema.includes("schema.getpostman.com/json/collection/v2.1.0")) {
		return "postman-v2.1";
	}

	if (detectGraphQLSDL(content, filePath)) {
		return "graphql-sdl";
	}

	return null;
}

/**
 * Parse a spec file into the Ruah Tool Schema IR.
 * Auto-detects the format from the file content.
 */
export function parse(filePath: string): RuahToolSchema {
	const content = readFileSync(filePath, "utf8");
	const format = detectFormat(content, filePath);

	if (!format) {
		throw new Error(
			`Cannot detect spec format for "${filePath}". Expected OpenAPI 3.x, Swagger 2.0, Postman v2.1, or GraphQL SDL.`,
		);
	}

	switch (format) {
		case "openapi-3.0":
		case "openapi-3.1":
		case "swagger-2.0":
		case "postman-v2.1": {
			let doc: Record<string, unknown>;
			try {
				doc = JSON.parse(content) as Record<string, unknown>;
			} catch {
				doc = parseYaml(content) as Record<string, unknown>;
			}

			if (format === "swagger-2.0") {
				return parseSwagger(filePath, doc);
			}
			if (format === "postman-v2.1") {
				return parsePostmanCollection(filePath, doc);
			}
			return parseOpenAPI(filePath, doc);
		}
		case "graphql-sdl":
			return parseGraphQLSDL(filePath, content);
		default:
			throw new Error(`Unsupported format: ${format}`);
	}
}

/**
 * List supported input formats.
 */
export function getSupportedFormats(): ParserInfo[] {
	return [
		{
			id: "openapi",
			name: "OpenAPI",
			formats: ["openapi-3.0", "openapi-3.1"],
		},
		{
			id: "swagger",
			name: "Swagger",
			formats: ["swagger-2.0"],
		},
		{
			id: "postman",
			name: "Postman Collection",
			formats: ["postman-v2.1"],
		},
		{
			id: "graphql",
			name: "GraphQL SDL",
			formats: ["graphql-sdl"],
		},
	];
}

function detectGraphQLSDL(content: string, filePath?: string): boolean {
	const ext = filePath ? extname(filePath).toLowerCase() : "";
	if (ext === ".graphql" || ext === ".gql") {
		return true;
	}

	const normalized = content.replace(/#[^\n]*/g, "");
	return (
		/(^|\n)\s*(type|input|enum|scalar)\s+[A-Za-z_]/.test(normalized) &&
		/\btype\s+(Query|Mutation)\b/.test(normalized)
	);
}
