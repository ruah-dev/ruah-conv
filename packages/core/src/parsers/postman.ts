import type {
	AuthSchema,
	IRObject,
	IRType,
	Parameter,
	RequestBody,
	ResponseSchema,
	RuahToolSchema,
	Tool,
} from "../ir/schema.js";
import { normalizeToolName, synthesizeToolName } from "../naming/index.js";
import { getMethodFlags, inferPagination, normalizeMethod } from "./shared.js";

export function parsePostmanCollection(
	filePath: string,
	doc: Record<string, unknown>,
): RuahToolSchema {
	const auth = extractAuth(doc);
	const tools = extractTools(doc, auth);

	return {
		meta: {
			title: String(
				(doc.info as Record<string, unknown> | undefined)?.name ??
					"Postman Collection",
			),
			version: String(
				(
					(doc.info as Record<string, unknown> | undefined)?.version as
						| Record<string, unknown>
						| string
						| undefined
				)?.toString?.() ??
					(doc.info as Record<string, unknown> | undefined)?.version ??
					"1.0.0",
			),
			description: String(
				(doc.description ??
					(doc.info as Record<string, unknown> | undefined)?.description ??
					"") ||
					undefined,
			),
			baseUrl: extractBaseUrl(doc, tools),
			sourceFormat: "postman-v2.1",
			sourceFile: filePath,
			generatedAt: new Date().toISOString(),
		},
		auth,
		tools,
		types: {},
	};
}

function extractTools(
	doc: Record<string, unknown>,
	auth: AuthSchema[],
): Tool[] {
	const items = Array.isArray(doc.item)
		? (doc.item as Array<Record<string, unknown>>)
		: [];
	const result: Tool[] = [];

	visitItems(items, [], result, auth);
	return result;
}

function visitItems(
	items: Array<Record<string, unknown>>,
	parents: string[],
	result: Tool[],
	auth: AuthSchema[],
): void {
	for (const item of items) {
		if (Array.isArray(item.item)) {
			visitItems(
				item.item as Array<Record<string, unknown>>,
				[...parents, String(item.name ?? "Group")],
				result,
				auth,
			);
			continue;
		}

		const request = item.request as Record<string, unknown> | undefined;
		if (!request) {
			continue;
		}

		const method = normalizeMethod(String(request.method ?? "GET"));
		const urlInfo = extractUrl(request.url);
		const requestBody = extractRequestBody(
			request.body as Record<string, unknown> | undefined,
		);
		const parameters = [
			...urlInfo.query,
			...extractHeaders(
				request.header as Array<Record<string, unknown>> | undefined,
			),
		];

		const rawName = normalizeToolName(
			String(item.name ?? `${method} ${urlInfo.path}`),
		);

		const toolAuth = extractRequestAuth(
			request.auth as Record<string, unknown> | undefined,
			auth,
		);
		const description = [parents.join(" / "), String(item.name ?? "")]
			.filter(Boolean)
			.join(" — ");

		const responses = extractResponses(
			item.response as Array<Record<string, unknown>> | undefined,
		);

		result.push({
			name:
				rawName.length > 0 ? rawName : synthesizeToolName(method, urlInfo.path),
			description: description || `${method} ${urlInfo.path}`,
			method,
			path: urlInfo.path,
			parameters,
			requestBody,
			responses,
			auth: toolAuth.length > 0 ? toolAuth : undefined,
			tags: parents.length > 0 ? parents : undefined,
			pagination: inferPagination(parameters),
			...getMethodFlags(method),
		});
	}
}

function extractUrl(url: unknown): {
	path: string;
	query: Parameter[];
	raw?: string;
} {
	if (typeof url === "string") {
		return parseUrlString(url);
	}

	const urlObject = (url as Record<string, unknown> | undefined) ?? {};
	const raw = typeof urlObject.raw === "string" ? urlObject.raw : undefined;
	const pathSegments = Array.isArray(urlObject.path)
		? (urlObject.path as unknown[]).map((segment) => String(segment))
		: undefined;
	const path =
		pathSegments && pathSegments.length > 0
			? `/${pathSegments.join("/")}`
			: raw
				? parseUrlString(raw).path
				: "/";
	const query = Array.isArray(urlObject.query)
		? (urlObject.query as Array<Record<string, unknown>>)
				.filter((param) => param.disabled !== true && param.key)
				.map((param) => ({
					name: String(param.key),
					in: "query" as const,
					required: false,
					description: param.description
						? String(param.description)
						: undefined,
					schema: inferSchemaFromSample(param.value),
					example: param.value,
				}))
		: [];

	return { path, query, raw };
}

function parseUrlString(raw: string): {
	path: string;
	query: Parameter[];
	raw: string;
} {
	const [pathOnly, queryString] = raw.split("?");
	const normalizedPath = normalizePath(pathOnly);
	const query: Parameter[] = [];

	if (queryString) {
		for (const pair of queryString.split("&")) {
			const [key, value] = pair.split("=");
			if (!key) continue;
			query.push({
				name: decodeURIComponent(key),
				in: "query",
				required: false,
				schema: inferSchemaFromSample(value),
				example: value,
			});
		}
	}

	return { path: normalizedPath, query, raw };
}

function normalizePath(value: string): string {
	if (!value) {
		return "/";
	}

	const withoutProtocol = value.replace(/^[a-z]+:\/\/[^/]+/i, "");
	const withoutTemplateHost = withoutProtocol.replace(/^{{[^}]+}}/, "");
	return withoutTemplateHost.startsWith("/")
		? withoutTemplateHost
		: `/${withoutTemplateHost}`;
}

function extractHeaders(
	headers: Array<Record<string, unknown>> | undefined,
): Parameter[] {
	return (headers ?? [])
		.filter(
			(header) =>
				header.disabled !== true &&
				typeof header.key === "string" &&
				!["content-type", "authorization"].includes(
					String(header.key).toLowerCase(),
				),
		)
		.map((header) => ({
			name: String(header.key),
			in: "header" as const,
			required: false,
			description: header.description ? String(header.description) : undefined,
			schema: inferSchemaFromSample(header.value),
			example: header.value,
		}));
}

function extractRequestBody(
	body: Record<string, unknown> | undefined,
): RequestBody | undefined {
	if (!body || typeof body !== "object") {
		return undefined;
	}

	const mode = String(body.mode ?? "");
	switch (mode) {
		case "raw":
			return buildRawRequestBody(body);
		case "urlencoded":
			return buildFieldRequestBody(
				"application/x-www-form-urlencoded",
				body.urlencoded as Array<Record<string, unknown>> | undefined,
			);
		case "formdata":
			return buildFieldRequestBody(
				"multipart/form-data",
				body.formdata as Array<Record<string, unknown>> | undefined,
			);
		default:
			return undefined;
	}
}

function buildRawRequestBody(body: Record<string, unknown>): RequestBody {
	const raw = String(body.raw ?? "");
	const language = String(
		(
			(body.options as Record<string, unknown> | undefined)?.raw as
				| Record<string, unknown>
				| undefined
		)?.language ?? "",
	).toLowerCase();

	if (language === "json" || looksLikeJson(raw)) {
		return {
			required: true,
			contentType: "application/json",
			schema: inferJsonBodySchema(raw),
			example: raw,
		};
	}

	return {
		required: true,
		contentType: "text/plain",
		schema: { kind: "string" },
		example: raw,
	};
}

function buildFieldRequestBody(
	contentType: string,
	fields: Array<Record<string, unknown>> | undefined,
): RequestBody | undefined {
	const activeFields = (fields ?? []).filter(
		(field) => field.disabled !== true && field.key,
	);
	if (activeFields.length === 0) {
		return undefined;
	}

	const properties: IRObject["properties"] = {};
	const required: string[] = [];

	for (const field of activeFields) {
		const name = String(field.key);
		properties[name] = {
			type:
				field.type === "file"
					? { kind: "string", format: "binary" }
					: inferSchemaFromSample(field.value),
			description: field.description ? String(field.description) : undefined,
		};
		if (field.required === true) {
			required.push(name);
		}
	}

	return {
		required: required.length > 0,
		contentType,
		schema: {
			kind: "object",
			properties,
			required,
		},
	};
}

function extractResponses(
	responses: Array<Record<string, unknown>> | undefined,
): ResponseSchema[] {
	return (responses ?? []).map((response) => {
		const body = typeof response.body === "string" ? response.body : undefined;
		const contentType = extractResponseContentType(
			response.header as Array<Record<string, unknown>> | undefined,
		);

		return {
			statusCode: String(response.code ?? "200"),
			description: response.name ? String(response.name) : undefined,
			contentType,
			schema:
				contentType === "application/json" && body
					? inferJsonBodySchema(body)
					: undefined,
		};
	});
}

function extractResponseContentType(
	headers: Array<Record<string, unknown>> | undefined,
): string | undefined {
	for (const header of headers ?? []) {
		if (String(header.key ?? "").toLowerCase() === "content-type") {
			return String(header.value);
		}
	}
	return undefined;
}

function extractAuth(doc: Record<string, unknown>): AuthSchema[] {
	const auth = doc.auth as Record<string, unknown> | undefined;
	if (!auth) {
		return [];
	}
	return [convertPostmanAuth("collectionAuth", auth)];
}

function extractRequestAuth(
	requestAuth: Record<string, unknown> | undefined,
	auth: AuthSchema[],
): string[] {
	if (requestAuth) {
		return [convertPostmanAuth("requestAuth", requestAuth).id];
	}
	return auth.length > 0 ? [auth[0].id] : [];
}

function convertPostmanAuth(
	id: string,
	auth: Record<string, unknown>,
): AuthSchema {
	const type = String(auth.type ?? "");
	switch (type) {
		case "apikey":
			return {
				id,
				type: "apiKey",
				in: "header",
				name: String(
					(auth.apikey as Array<Record<string, unknown>> | undefined)?.find(
						(entry) => entry.key === "key",
					)?.value ?? "X-API-Key",
				),
			};
		case "bearer":
			return {
				id,
				type: "http",
				scheme: "bearer",
			};
		case "basic":
			return {
				id,
				type: "http",
				scheme: "basic",
			};
		default:
			return {
				id,
				type: "http",
				scheme: type || "bearer",
			};
	}
}

function extractBaseUrl(
	doc: Record<string, unknown>,
	tools: Tool[],
): string | undefined {
	const variables = Array.isArray(doc.variable)
		? (doc.variable as Array<Record<string, unknown>>)
		: [];
	const baseUrlVar = variables.find((entry) => entry.key === "baseUrl");
	if (baseUrlVar?.value) {
		return String(baseUrlVar.value);
	}

	for (const tool of tools) {
		if (tool.path.startsWith("http://") || tool.path.startsWith("https://")) {
			const url = new URL(tool.path);
			return `${url.protocol}//${url.host}`;
		}
	}

	return undefined;
}

function inferSchemaFromSample(value: unknown): IRType {
	if (typeof value === "boolean") {
		return { kind: "boolean" };
	}
	if (typeof value === "number") {
		return Number.isInteger(value) ? { kind: "integer" } : { kind: "number" };
	}
	if (typeof value === "string") {
		if (/^-?\d+$/.test(value)) {
			return { kind: "integer" };
		}
		if (/^-?\d+\.\d+$/.test(value)) {
			return { kind: "number" };
		}
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
	if (value === null) {
		return { kind: "unknown", nullable: true };
	}
	if (typeof value === "string") {
		return { kind: "string" };
	}
	if (typeof value === "boolean") {
		return { kind: "boolean" };
	}
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

function looksLikeJson(raw: string): boolean {
	const trimmed = raw.trim();
	return (
		(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
		(trimmed.startsWith("[") && trimmed.endsWith("]"))
	);
}
