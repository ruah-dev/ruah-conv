import { basename } from "node:path";
import type {
	AuthSchema,
	IRObject,
	IRType,
	Parameter,
	RequestBody,
	RuahToolSchema,
	SourceFormat,
	Tool,
} from "../ir/schema.js";
import { synthesizeToolName } from "../naming/index.js";
import { SpecParseError } from "./errors.js";
import { getMethodFlags, inferPagination, normalizeMethod } from "./shared.js";

// HAR's SourceFormat tag is registered locally — the shared IR enum is owned
// by another wave's scope, so we cast at this single boundary instead of
// editing the IR. Downstream consumers treat sourceFormat as an opaque string.
const HAR_SOURCE_FORMAT = "har" as unknown as SourceFormat;

interface HarEntry {
	request: {
		method: string;
		url: string;
		headers?: Array<{ name: string; value: string }>;
		queryString?: Array<{ name: string; value: string }>;
		postData?: { mimeType?: string; text?: string };
	};
	response?: { status?: number };
}

interface GroupedOperation {
	method: string;
	pathTemplate: string;
	origin: string;
	entries: HarEntry[];
}

export function parseHar(filePath: string, raw: string): RuahToolSchema {
	let doc: { log?: { entries?: unknown[] } };
	try {
		doc = JSON.parse(raw) as { log?: { entries?: unknown[] } };
	} catch (cause) {
		throw new SpecParseError(
			`Failed to parse HAR JSON at ${filePath}`,
			filePath,
			"har",
			cause,
		);
	}

	if (!doc.log || !Array.isArray(doc.log.entries)) {
		throw new SpecParseError(
			`HAR file at ${filePath} is missing "log.entries"`,
			filePath,
			"har",
		);
	}

	const entries = doc.log.entries.filter(isHarEntry);
	const auth = detectAuth(entries);
	const groups = groupEntries(entries);
	const tools = groups.map((group) => buildTool(group, auth));

	return {
		meta: {
			title: deriveTitle(filePath),
			version: "1.0.0",
			description: undefined,
			baseUrl: deriveBaseUrl(groups),
			sourceFormat: HAR_SOURCE_FORMAT,
			sourceFile: filePath,
			generatedAt: new Date().toISOString(),
		},
		auth,
		tools,
		types: {},
	};
}

function isHarEntry(value: unknown): value is HarEntry {
	if (!value || typeof value !== "object") return false;
	const request = (value as { request?: unknown }).request;
	if (!request || typeof request !== "object") return false;
	const { method, url } = request as { method?: unknown; url?: unknown };
	return typeof method === "string" && typeof url === "string";
}

// Path-template inference: collapse sibling segments that look like IDs
// (numeric, UUID, or hex) across entries sharing the same method + prefix
// shape. Conservative — segments that don't match the ID pattern stay literal.
function groupEntries(entries: HarEntry[]): GroupedOperation[] {
	const buckets = new Map<string, GroupedOperation>();

	for (const entry of entries) {
		const parsed = safeParseUrl(entry.request.url);
		if (!parsed) continue;

		const origin = `${parsed.protocol}//${parsed.host}`;
		const segments = parsed.pathname.split("/").filter(Boolean);
		const templateSegments = segments.map((segment) =>
			looksLikeId(segment) ? "{id}" : segment,
		);
		const pathTemplate = `/${templateSegments.join("/")}`;
		const method = normalizeMethod(entry.request.method);
		const key = `${method} ${origin}${pathTemplate}`;

		const existing = buckets.get(key);
		if (existing) {
			existing.entries.push(entry);
		} else {
			buckets.set(key, {
				method,
				pathTemplate: pathTemplate === "/" ? "/" : pathTemplate,
				origin,
				entries: [entry],
			});
		}
	}

	return [...buckets.values()];
}

function looksLikeId(segment: string): boolean {
	if (/^\d+$/.test(segment)) return true;
	if (
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			segment,
		)
	) {
		return true;
	}
	if (/^[0-9a-f]{24,}$/i.test(segment)) return true;
	return false;
}

function buildTool(group: GroupedOperation, auth: AuthSchema[]): Tool {
	const method = normalizeMethod(group.method);
	const pathParams = extractPathParams(group.pathTemplate);
	const queryParams = mergeQueryParams(group.entries);
	const parameters: Parameter[] = [...pathParams, ...queryParams];
	const requestBody = inferRequestBody(group.entries);
	const toolAuth =
		auth.length > 0 ? auth.map((scheme) => scheme.id) : undefined;
	const callCount = group.entries.length;

	return {
		name: synthesizeToolName(method, group.pathTemplate),
		description: `Captured from HAR — ${callCount} call${callCount === 1 ? "" : "s"} observed`,
		method,
		path: group.pathTemplate,
		parameters,
		requestBody,
		responses: [],
		auth: toolAuth,
		pagination: inferPagination(parameters),
		...getMethodFlags(method),
	};
}

function extractPathParams(template: string): Parameter[] {
	const matches = template.matchAll(/\{([^}]+)\}/g);
	const params: Parameter[] = [];
	for (const match of matches) {
		params.push({
			name: match[1],
			in: "path",
			required: true,
			schema: { kind: "string" },
		});
	}
	return params;
}

function mergeQueryParams(entries: HarEntry[]): Parameter[] {
	const seen = new Map<string, Parameter>();
	for (const entry of entries) {
		for (const param of entry.request.queryString ?? []) {
			if (!param?.name || seen.has(param.name)) continue;
			seen.set(param.name, {
				name: param.name,
				in: "query",
				required: false,
				schema: inferSchemaFromSample(param.value),
				example: param.value,
			});
		}
	}
	return [...seen.values()];
}

function inferRequestBody(entries: HarEntry[]): RequestBody | undefined {
	for (const entry of entries) {
		const postData = entry.request.postData;
		if (!postData) continue;
		const mime = (postData.mimeType ?? "").toLowerCase();
		const text = postData.text ?? "";
		if (!text) continue;
		if (mime.includes("application/json")) {
			return {
				required: true,
				contentType: "application/json",
				schema: inferJsonBodySchema(text),
				example: text,
			};
		}
		return {
			required: true,
			contentType: mime || "text/plain",
			schema: { kind: "string" },
			example: text,
		};
	}
	return undefined;
}

function detectAuth(entries: HarEntry[]): AuthSchema[] {
	const schemes: AuthSchema[] = [];
	let hasBearer = false;
	let apiKeyHeader: string | undefined;

	for (const entry of entries) {
		for (const header of entry.request.headers ?? []) {
			const name = (header.name ?? "").toLowerCase();
			const value = header.value ?? "";
			if (name === "authorization" && /^bearer\s+/i.test(value)) {
				hasBearer = true;
			} else if (name === "x-api-key" || name.endsWith("-api-key")) {
				apiKeyHeader = header.name;
			}
		}
	}

	if (hasBearer) {
		schemes.push({ id: "bearerAuth", type: "http", scheme: "bearer" });
	}
	if (apiKeyHeader) {
		schemes.push({
			id: "apiKeyAuth",
			type: "apiKey",
			in: "header",
			name: apiKeyHeader,
		});
	}
	return schemes;
}

function deriveBaseUrl(groups: GroupedOperation[]): string | undefined {
	const origins = new Set(groups.map((group) => group.origin));
	if (origins.size === 1) {
		return [...origins][0];
	}
	return undefined;
}

function deriveTitle(filePath: string): string {
	const base = basename(filePath).replace(/\.har$/i, "");
	return base ? `${base} (HAR Import)` : "HAR Import";
}

function safeParseUrl(
	raw: string,
): { protocol: string; host: string; pathname: string } | null {
	try {
		const url = new URL(raw);
		return { protocol: url.protocol, host: url.host, pathname: url.pathname };
	} catch {
		return null;
	}
}

function inferSchemaFromSample(value: unknown): IRType {
	if (typeof value === "boolean") return { kind: "boolean" };
	if (typeof value === "number") {
		return Number.isInteger(value) ? { kind: "integer" } : { kind: "number" };
	}
	if (typeof value === "string") {
		if (value === "true" || value === "false") return { kind: "boolean" };
		if (/^-?\d+$/.test(value)) return { kind: "integer" };
		if (/^-?\d+\.\d+$/.test(value)) return { kind: "number" };
		return { kind: "string" };
	}
	return { kind: "unknown" };
}

function inferJsonBodySchema(raw: string): IRType {
	try {
		return inferJsonValueType(JSON.parse(raw));
	} catch {
		return { kind: "unknown" };
	}
}

function inferJsonValueType(value: unknown): IRType {
	if (value === null) return { kind: "unknown", nullable: true };
	if (typeof value === "string") return { kind: "string" };
	if (typeof value === "boolean") return { kind: "boolean" };
	if (typeof value === "number") {
		return Number.isInteger(value) ? { kind: "integer" } : { kind: "number" };
	}
	if (Array.isArray(value)) {
		return {
			kind: "array",
			items:
				value.length > 0 ? inferJsonValueType(value[0]) : { kind: "unknown" },
		};
	}
	if (typeof value === "object") {
		const properties: IRObject["properties"] = {};
		const required: string[] = [];
		for (const [key, entry] of Object.entries(
			value as Record<string, unknown>,
		)) {
			properties[key] = { type: inferJsonValueType(entry) };
			required.push(key);
		}
		return { kind: "object", properties, required };
	}
	return { kind: "unknown" };
}
