// Ruah Tool Schema — the intermediate representation (IR)
// Every input parser produces this. Every output generator consumes this.

// ── Top-level container ──────────────────────────────────────────────

export interface RuahToolSchema {
	meta: SchemaMeta;
	auth: AuthSchema[];
	tools: Tool[];
	types: Record<string, TypeDefinition>;
}

// ── Metadata ─────────────────────────────────────────────────────────

export interface SchemaMeta {
	title: string;
	version: string;
	description?: string;
	baseUrl?: string;
	sourceFormat: SourceFormat;
	sourceFile: string;
	generatedAt: string;
}

export type SourceFormat =
	| "openapi-3.0"
	| "openapi-3.1"
	| "swagger-2.0"
	| "postman-v2.1"
	| "graphql-sdl";

// ── Authentication ───────────────────────────────────────────────────

export interface AuthSchema {
	id: string;
	type: "apiKey" | "http" | "oauth2" | "openIdConnect";
	scheme?: string; // for http: "bearer", "basic"
	in?: "header" | "query" | "cookie"; // for apiKey
	name?: string; // header/query param name for apiKey
	description?: string;
}

// ── Tools (one per API operation) ────────────────────────────────────

export interface Tool {
	name: string;
	description: string;
	operationId?: string;
	method: HttpMethod;
	path: string;
	parameters: Parameter[];
	requestBody?: RequestBody;
	responses: ResponseSchema[];
	auth?: string[]; // references to AuthSchema.id
	tags?: string[];
	deprecated?: boolean;

	// Behavior flags
	idempotent: boolean;
	readOnly: boolean;
	riskLevel: "safe" | "moderate" | "destructive";
	pagination?: PaginationInfo;
}

export type HttpMethod =
	| "GET"
	| "POST"
	| "PUT"
	| "PATCH"
	| "DELETE"
	| "HEAD"
	| "OPTIONS";

export interface PaginationInfo {
	style: "offset-limit" | "page-number" | "cursor";
	params: string[];
}

// ── Parameters ───────────────────────────────────────────────────────

export interface Parameter {
	name: string;
	in: "path" | "query" | "header" | "cookie";
	required: boolean;
	description?: string;
	schema: IRType;
	example?: unknown;
}

// ── Request Body ─────────────────────────────────────────────────────

export interface RequestBody {
	required: boolean;
	description?: string;
	contentType: string;
	schema: IRType;
	example?: unknown;
}

// ── Responses ────────────────────────────────────────────────────────

export interface ResponseSchema {
	statusCode: string;
	description?: string;
	contentType?: string;
	schema?: IRType;
}

// ── Type System (recursive, discriminated union) ─────────────────────

export type IRType =
	| IRPrimitive
	| IRObject
	| IRArray
	| IRRef
	| IREnum
	| IRComposite
	| IRUnknown;

export interface IRPrimitive {
	kind: "string" | "number" | "integer" | "boolean";
	format?: string;
	pattern?: string;
	minimum?: number;
	maximum?: number;
	description?: string;
	nullable?: boolean;
}

export interface IRObject {
	kind: "object";
	properties: Record<string, IRProperty>;
	required: string[];
	additionalProperties?: boolean | IRType;
	description?: string;
	nullable?: boolean;
}

export interface IRProperty {
	type: IRType;
	description?: string;
}

export interface IRArray {
	kind: "array";
	items: IRType;
	description?: string;
	nullable?: boolean;
}

export interface IRRef {
	kind: "ref";
	$ref: string; // name of entry in types map
	description?: string;
	nullable?: boolean;
}

export interface IREnum {
	kind: "enum";
	values: (string | number | boolean)[];
	description?: string;
	nullable?: boolean;
}

export interface IRComposite {
	kind: "oneOf" | "anyOf" | "allOf";
	variants: IRType[];
	description?: string;
	nullable?: boolean;
}

export interface IRUnknown {
	kind: "unknown";
	description?: string;
	nullable?: boolean;
}

// ── Named type definitions (from components/schemas) ─────────────────

export interface TypeDefinition {
	name: string;
	description?: string;
	type: IRType;
}

// ── Validation ───────────────────────────────────────────────────────

export interface ValidationWarning {
	path: string;
	code: WarningCode;
	message: string;
}

export type WarningCode =
	| "missing-description"
	| "missing-base-url"
	| "duplicate-tool-name"
	| "long-tool-name"
	| "unknown-type"
	| "unresolved-ref"
	| "missing-param-description"
	| "no-operations";
