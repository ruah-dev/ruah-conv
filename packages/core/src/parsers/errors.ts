// Typed error class for parser boundary failures.
// Any failure inside parse() — file read, format detection, YAML/JSON parse,
// or parser-specific failure — is wrapped in a SpecParseError so the CLI and
// programmatic callers get a single error type with consistent context.

export class SpecParseError extends Error {
	readonly path: string;
	readonly format: string | "unknown";
	override readonly cause: unknown;

	constructor(
		message: string,
		path: string,
		format: string | "unknown",
		cause?: unknown,
	) {
		super(message);
		this.name = "SpecParseError";
		this.path = path;
		this.format = format;
		this.cause = cause;
	}
}

export function formatLabel(format: string | "unknown"): string {
	switch (format) {
		case "openapi-3.0":
		case "openapi-3.1":
			return "OpenAPI";
		case "swagger-2.0":
			return "Swagger";
		case "postman-v2.1":
			return "Postman collection";
		case "graphql-sdl":
			return "GraphQL SDL";
		case "har":
			return "HAR capture";
		default:
			return "spec";
	}
}
