// Parser registry — auto-detect format and dispatch to the right parser.

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { RuahToolSchema, SourceFormat } from "../ir/schema.js";
import { parseOpenAPI } from "./openapi.js";

export interface ParserInfo {
	id: string;
	name: string;
	formats: string[];
}

/**
 * Detect the spec format from file content.
 * Returns null if the format is not recognized.
 */
export function detectFormat(content: string): SourceFormat | null {
	let doc: Record<string, unknown>;

	try {
		doc = JSON.parse(content) as Record<string, unknown>;
	} catch {
		try {
			doc = parseYaml(content) as Record<string, unknown>;
		} catch {
			return null;
		}
	}

	const openapi = doc.openapi;
	if (typeof openapi === "string") {
		if (openapi.startsWith("3.1")) return "openapi-3.1";
		if (openapi.startsWith("3.0")) return "openapi-3.0";
	}

	return null;
}

/**
 * Parse a spec file into the Ruah Tool Schema IR.
 * Auto-detects the format from the file content.
 */
export function parse(filePath: string): RuahToolSchema {
	const content = readFileSync(filePath, "utf8");
	const format = detectFormat(content);

	if (!format) {
		throw new Error(
			`Cannot detect spec format for "${filePath}". Expected OpenAPI 3.0 or 3.1.`,
		);
	}

	let doc: Record<string, unknown>;
	try {
		doc = JSON.parse(content) as Record<string, unknown>;
	} catch {
		doc = parseYaml(content) as Record<string, unknown>;
	}

	switch (format) {
		case "openapi-3.0":
		case "openapi-3.1":
			return parseOpenAPI(filePath, doc);
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
	];
}
