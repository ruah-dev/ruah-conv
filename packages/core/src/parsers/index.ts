// Parser registry — auto-detect format and dispatch to the right parser.

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { RuahToolSchema, SourceFormat } from "../ir/schema.js";
import { formatLabel, SpecParseError } from "./errors.js";
import { parseGraphQLSDL } from "./graphql.js";
import { parseHar } from "./har.js";
import { parseOpenAPI } from "./openapi.js";
import { parsePostmanCollection } from "./postman.js";
import { parseSwagger } from "./swagger.js";

export { SpecParseError } from "./errors.js";

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
	// Fast path: .har extension wins before JSON parsing (HAR files are valid
	// JSON but the structure check below is also a reliable sniff).
	if (filePath && extname(filePath).toLowerCase() === ".har") {
		return "har" as unknown as SourceFormat;
	}

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

	const log = doc.log as Record<string, unknown> | undefined;
	if (log && Array.isArray(log.entries) && typeof log.version === "string") {
		return "har" as unknown as SourceFormat;
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
 *
 * Any failure (file read, format detection, YAML/JSON parse, parser-specific
 * failure) throws a SpecParseError with the source path, detected format,
 * and underlying cause attached.
 */
export function parse(filePath: string): RuahToolSchema {
	let format: SourceFormat | "unknown" = "unknown";

	let content: string;
	try {
		content = readFileSync(filePath, "utf8");
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		throw new SpecParseError(
			`Failed to read spec at ${filePath}: ${message}`,
			filePath,
			format,
			cause,
		);
	}

	let detected: SourceFormat | null;
	try {
		detected = detectFormat(content, filePath);
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		throw new SpecParseError(
			`Failed to detect spec format for ${filePath}: ${message}`,
			filePath,
			format,
			cause,
		);
	}

	if (!detected) {
		throw new SpecParseError(
			`Cannot detect spec format for "${filePath}". Expected OpenAPI 3.x, Swagger 2.0, Postman v2.1, GraphQL SDL, or HAR.`,
			filePath,
			"unknown",
		);
	}

	format = detected;

	try {
		if ((detected as string) === "har") {
			return parseHar(filePath, content);
		}
		switch (detected) {
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

				if (detected === "swagger-2.0") {
					return parseSwagger(filePath, doc);
				}
				if (detected === "postman-v2.1") {
					return parsePostmanCollection(filePath, doc);
				}
				return parseOpenAPI(filePath, doc);
			}
			case "graphql-sdl":
				return parseGraphQLSDL(filePath, content);
			default:
				throw new Error(`Unsupported format: ${detected}`);
		}
	} catch (cause) {
		if (cause instanceof SpecParseError) {
			throw cause;
		}
		const message = cause instanceof Error ? cause.message : String(cause);
		throw new SpecParseError(
			`Failed to parse ${formatLabel(format)} spec at ${filePath}: ${message}`,
			filePath,
			format,
			cause,
		);
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
		{
			id: "har",
			name: "HAR Capture",
			formats: ["har"],
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
