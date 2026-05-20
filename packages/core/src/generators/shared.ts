import type {
	AuthSchema,
	IRType,
	RequestBody,
	RuahToolSchema,
	Tool,
	TypeDefinition,
} from "../ir/schema.js";

export interface ToolSchemaResult {
	schema: Record<string, unknown>;
	flattenedBody: boolean;
}

export function buildToolInputSchema(
	tool: Tool,
	spec: RuahToolSchema,
): ToolSchemaResult {
	const properties: Record<string, unknown> = {};
	const required = new Set<string>();

	for (const param of tool.parameters) {
		properties[param.name] = irTypeToJsonSchema(param.schema, spec.types);
		if (param.description) {
			(properties[param.name] as Record<string, unknown>).description =
				param.description;
		}
		if (param.required || param.in === "path") {
			required.add(param.name);
		}
	}

	let flattenedBody = false;
	if (tool.requestBody && !shouldSkipRequestBodyInToolSchema(tool)) {
		flattenedBody = appendRequestBodySchema(
			properties,
			required,
			tool.requestBody,
			spec.types,
		);
	}

	const schema: Record<string, unknown> = {
		type: "object",
		properties,
	};

	if (required.size > 0) {
		schema.required = [...required];
	}

	return { schema, flattenedBody };
}

export interface ToolDefinitionMeta {
	risk: Tool["riskLevel"];
	method: Tool["method"];
	path: string;
	pagination?: Tool["pagination"];
	auth?: string[];
	deprecated?: true;
}

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	_meta: { ruah: ToolDefinitionMeta };
}

export function buildToolDefinitions(spec: RuahToolSchema): ToolDefinition[] {
	return spec.tools.map((tool) => {
		const meta: ToolDefinitionMeta = {
			risk: tool.riskLevel,
			method: tool.method,
			path: tool.path,
		};
		if (tool.pagination) meta.pagination = tool.pagination;
		if (tool.auth && tool.auth.length > 0) meta.auth = [...tool.auth];
		if (tool.deprecated) meta.deprecated = true;

		return {
			name: tool.name,
			description: enrichToolDescription(tool),
			inputSchema: buildToolInputSchema(tool, spec).schema,
			_meta: { ruah: meta },
		};
	});
}

export function buildOperationSpecs(spec: RuahToolSchema) {
	return spec.tools.map((tool) => ({
		name: tool.name,
		description: enrichToolDescription(tool),
		method: tool.method,
		path: tool.path,
		parameters: tool.parameters.map((param) => ({
			name: param.name,
			in: param.in,
			required: param.required || param.in === "path",
		})),
		requestBody: buildRequestBodyMeta(tool.requestBody),
	}));
}

export function enrichToolDescription(tool: Tool): string {
	const base = (tool.description ?? "").trim();
	const parts: string[] = [];
	if (base) parts.push(base);
	if (tool.pagination) {
		parts.push(
			`Pagination: ${tool.pagination.style} via ${tool.pagination.params.join(", ")}.`,
		);
	}
	if (tool.riskLevel !== "safe") {
		const hint =
			tool.riskLevel === "destructive"
				? "Risk: destructive — this operation modifies or removes state."
				: "Risk: moderate — this operation may modify state.";
		parts.push(hint);
	}
	return parts.join("\n\n");
}

function appendRequestBodySchema(
	properties: Record<string, unknown>,
	required: Set<string>,
	requestBody: RequestBody,
	types: Record<string, TypeDefinition>,
): boolean {
	const bodySchema = irTypeToJsonSchema(requestBody.schema, types);
	if (
		typeof bodySchema === "object" &&
		bodySchema !== null &&
		(bodySchema as Record<string, unknown>).type === "object" &&
		"properties" in bodySchema
	) {
		const bodyProps =
			((bodySchema as Record<string, unknown>).properties as Record<
				string,
				unknown
			>) ?? {};
		const bodyRequired =
			((bodySchema as Record<string, unknown>).required as string[]) ?? [];
		Object.assign(properties, bodyProps);
		if (requestBody.required) {
			for (const key of bodyRequired) {
				required.add(key);
			}
		}
		return true;
	}

	properties.body = bodySchema;
	if (requestBody.description) {
		(properties.body as Record<string, unknown>).description =
			requestBody.description;
	}
	if (requestBody.required) {
		required.add("body");
	}
	return false;
}

function buildRequestBodyMeta(requestBody: RequestBody | undefined) {
	if (!requestBody) {
		return undefined;
	}

	return {
		required: requestBody.required,
		contentType: requestBody.contentType,
		schema: requestBody.schema,
	};
}

function shouldSkipRequestBodyInToolSchema(tool: Tool): boolean {
	return (
		tool.path === "/graphql" &&
		tool.requestBody?.contentType === "application/json" &&
		tool.parameters.length > 0
	);
}

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
			if (type.additionalProperties === false) {
				schema.additionalProperties = false;
			} else if (type.additionalProperties === true) {
				schema.additionalProperties = true;
			} else if (type.additionalProperties) {
				schema.additionalProperties = irTypeToJsonSchema(
					type.additionalProperties,
					types,
					visited,
				);
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
				[type.kind]: type.variants.map((variant) =>
					irTypeToJsonSchema(variant, types, visited),
				),
			};
			if (type.description) schema.description = type.description;
			return schema;
		}

		case "allOf": {
			const schema: Record<string, unknown> = {
				allOf: type.variants.map((variant) =>
					irTypeToJsonSchema(variant, types, visited),
				),
			};
			if (type.description) schema.description = type.description;
			return schema;
		}

		case "unknown":
			return type.description ? { description: type.description } : {};
	}
}

// ── Auth wiring (schema-driven) ──────────────────────────────────────

export interface AuthWiringPlanEntry {
	scheme: AuthSchema;
	envVar: string;
	// Only set for HTTP basic — basic auth needs two env vars.
	passwordEnvVar?: string;
	// "header" | "query" — derived from the spec; oauth2/bearer always "header".
	in: "header" | "query";
	// Header or query parameter name. For bearer/oauth2 it's "Authorization".
	name: string;
}

export interface AuthWiringPlan {
	enabled: boolean;
	entries: AuthWiringPlanEntry[];
	envVarSummary: string[];
}

/**
 * Plan the runtime auth-wiring for a spec. Returns one entry per supported
 * auth scheme; unsupported kinds (openIdConnect) are skipped silently.
 */
export function buildAuthWiringPlan(
	auth: AuthSchema[],
	enabled: boolean,
): AuthWiringPlan {
	if (!enabled || auth.length === 0) {
		return { enabled: false, entries: [], envVarSummary: [] };
	}

	const apiKeyCount = auth.filter((s) => s.type === "apiKey").length;
	const bearerCount = auth.filter(
		(s) => s.type === "http" && s.scheme?.toLowerCase() === "bearer",
	).length;
	const basicCount = auth.filter(
		(s) => s.type === "http" && s.scheme?.toLowerCase() === "basic",
	).length;
	const oauthCount = auth.filter((s) => s.type === "oauth2").length;

	const entries: AuthWiringPlanEntry[] = [];

	for (const scheme of auth) {
		const idPart = toEnvSuffix(scheme.id);
		if (scheme.type === "apiKey") {
			if (scheme.in !== "header" && scheme.in !== "query") continue;
			if (!scheme.name) continue;
			const envVar = apiKeyCount > 1 ? `API_KEY_${idPart}` : "API_KEY";
			entries.push({
				scheme,
				envVar,
				in: scheme.in,
				name: scheme.name,
			});
		} else if (scheme.type === "http") {
			const httpScheme = scheme.scheme?.toLowerCase();
			if (httpScheme === "bearer") {
				const envVar =
					bearerCount > 1 ? `BEARER_TOKEN_${idPart}` : "BEARER_TOKEN";
				entries.push({
					scheme,
					envVar,
					in: "header",
					name: "Authorization",
				});
			} else if (httpScheme === "basic") {
				const userVar =
					basicCount > 1 ? `BASIC_AUTH_USER_${idPart}` : "BASIC_AUTH_USER";
				const passVar =
					basicCount > 1 ? `BASIC_AUTH_PASS_${idPart}` : "BASIC_AUTH_PASS";
				entries.push({
					scheme,
					envVar: userVar,
					passwordEnvVar: passVar,
					in: "header",
					name: "Authorization",
				});
			}
		} else if (scheme.type === "oauth2") {
			const envVar = oauthCount > 1 ? `OAUTH_TOKEN_${idPart}` : "OAUTH_TOKEN";
			entries.push({
				scheme,
				envVar,
				in: "header",
				name: "Authorization",
			});
		}
	}

	const envVarSummary: string[] = [];
	for (const entry of entries) {
		envVarSummary.push(entry.envVar);
		if (entry.passwordEnvVar) envVarSummary.push(entry.passwordEnvVar);
	}

	return { enabled: true, entries, envVarSummary };
}

function toEnvSuffix(id: string): string {
	return id.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
}

// ── Identifier safety helpers (defence against IR-sourced injection) ──

const PYTHON_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PYTHON_RESERVED = new Set([
	"False",
	"None",
	"True",
	"and",
	"as",
	"assert",
	"async",
	"await",
	"break",
	"class",
	"continue",
	"def",
	"del",
	"elif",
	"else",
	"except",
	"finally",
	"for",
	"from",
	"global",
	"if",
	"import",
	"in",
	"is",
	"lambda",
	"nonlocal",
	"not",
	"or",
	"pass",
	"raise",
	"return",
	"try",
	"while",
	"with",
	"yield",
	"match",
	"case",
]);

/**
 * Sanitize an arbitrary string into a safe Python identifier. Used wherever
 * IR-sourced strings (tool names, request-body property keys, etc.) are
 * interpolated into generated Python source as identifiers — e.g. `def NAME(`
 * or parameter names. Without this, a HAR file with a malicious JSON key
 * could inject executable Python into the generated server.
 */
export function toSafePythonIdent(name: string, fallback: string): string {
	let cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");
	if (cleaned === "" || /^[0-9]/.test(cleaned)) {
		cleaned = `_${cleaned}`;
	}
	if (PYTHON_RESERVED.has(cleaned)) {
		cleaned = `${cleaned}_`;
	}
	return PYTHON_IDENT_RE.test(cleaned) ? cleaned : fallback;
}

/**
 * Render the body of the TypeScript `applyAuth(headers, url, operationAuth)` function.
 * Always returns a valid function body — if no entries, it's a no-op.
 *
 * Semantics:
 *   - Each entry is only applied when its scheme.id appears in `operationAuth`,
 *     OR when `operationAuth` is empty and the entry's id is in the
 *     DEFAULT_AUTH_SCHEMES fallback (also generated, includes every scheme id
 *     declared in the plan).
 *   - First applicable scheme that targets the "Authorization" header wins;
 *     subsequent Authorization-setting blocks are skipped this call.
 */
export function renderAuthWiringTs(plan: AuthWiringPlan): string {
	if (!plan.enabled || plan.entries.length === 0) {
		return "  // No auth schemes declared in spec — no-op.\n";
	}

	const blocks: string[] = [];
	for (const entry of plan.entries) {
		const idLit = JSON.stringify(entry.scheme.id);
		const gateOpen = `  if (_shouldApply(${idLit}, operationAuth)) {`;
		const gateClose = `  }`;
		if (entry.scheme.type === "http" && entry.passwordEnvVar) {
			// Basic auth — two env vars
			blocks.push(`${gateOpen}
    if (!_authSet) {
      const user = process.env[${JSON.stringify(entry.envVar)}];
      const pass = process.env[${JSON.stringify(entry.passwordEnvVar)}];
      if (user !== undefined && pass !== undefined) {
        const encoded = Buffer.from(user + ":" + pass).toString("base64");
        headers[${JSON.stringify(entry.name)}] = "Basic " + encoded;
        _authSet = true;
      } else if (user !== undefined || pass !== undefined) {
        console.warn(${JSON.stringify(`[auth] Partial basic-auth config: set both ${entry.envVar} and ${entry.passwordEnvVar}.`)});
      }
    }
${gateClose}`);
			continue;
		}
		if (
			entry.scheme.type === "http" &&
			entry.scheme.scheme?.toLowerCase() === "bearer"
		) {
			blocks.push(`${gateOpen}
    if (!_authSet) {
      const token = process.env[${JSON.stringify(entry.envVar)}];
      if (token) {
        headers[${JSON.stringify(entry.name)}] = "Bearer " + token;
        _authSet = true;
      }
    }
${gateClose}`);
			continue;
		}
		if (entry.scheme.type === "oauth2") {
			blocks.push(`${gateOpen}
    // oauth2 — token must be obtained externally; set ${entry.envVar} to a valid bearer token.
    if (!_authSet) {
      const token = process.env[${JSON.stringify(entry.envVar)}];
      if (token) {
        headers[${JSON.stringify(entry.name)}] = "Bearer " + token;
        _authSet = true;
      }
    }
${gateClose}`);
			continue;
		}
		// apiKey
		if (entry.in === "query") {
			blocks.push(`${gateOpen}
    const key = process.env[${JSON.stringify(entry.envVar)}];
    if (key) {
      url.searchParams.set(${JSON.stringify(entry.name)}, key);
    }
${gateClose}`);
		} else {
			// header apiKey — not Authorization (usually X-API-Key etc.) — no first-wins guard.
			blocks.push(`${gateOpen}
    const key = process.env[${JSON.stringify(entry.envVar)}];
    if (key) {
      headers[${JSON.stringify(entry.name)}] = key;
    }
${gateClose}`);
		}
	}

	const preamble = `  let _authSet = false;\n`;
	return `${preamble}${blocks.join("\n")}\n`;
}

/**
 * Render the JS array literal listing every auth scheme id in the plan.
 * Used as DEFAULT_AUTH_SCHEMES when an operation declares no security.
 */
export function renderDefaultAuthSchemesTs(plan: AuthWiringPlan): string {
	const ids = plan.entries.map((entry) => JSON.stringify(entry.scheme.id));
	return `[${ids.join(", ")}]`;
}

/**
 * Render the Python list literal listing every auth scheme id in the plan.
 */
export function renderDefaultAuthSchemesPython(plan: AuthWiringPlan): string {
	const ids = plan.entries.map((entry) => JSON.stringify(entry.scheme.id));
	return `[${ids.join(", ")}]`;
}

/**
 * Build the .env.example content for a scaffold. Lists every supported scheme
 * with its env var(s), or a stub note for oauth2.
 */
export function renderEnvExample(
	plan: AuthWiringPlan,
	specTitle: string,
): string {
	const header = `# Auth env vars for the ${specTitle} scaffold.\n# Each scheme declared in the spec maps to one or more env vars.\n# Uncomment and fill in the ones your endpoints require.\n`;
	if (!plan.enabled || plan.entries.length === 0) {
		return `${header}\n# (no auth schemes declared)\n`;
	}

	const blocks: string[] = [];
	for (const entry of plan.entries) {
		const scheme = entry.scheme;
		const id = scheme.id;
		if (scheme.type === "apiKey") {
			const where = entry.in === "query" ? "query" : "header";
			blocks.push(
				`# ${id} — apiKey in ${where} (${entry.name})\n# ${entry.envVar}=`,
			);
		} else if (scheme.type === "http" && entry.passwordEnvVar) {
			blocks.push(
				`# ${id} — http/basic\n# ${entry.envVar}=\n# ${entry.passwordEnvVar}=`,
			);
		} else if (
			scheme.type === "http" &&
			scheme.scheme?.toLowerCase() === "bearer"
		) {
			blocks.push(`# ${id} — http/bearer\n# ${entry.envVar}=`);
		} else if (scheme.type === "oauth2") {
			blocks.push(
				`# ${id} — oauth2 (obtain a token externally and set the bearer below)\n# ${entry.envVar}=`,
			);
		}
	}

	return `${header}\n${blocks.join("\n\n")}\n`;
}

/**
 * Render the body of the Python `apply_auth(headers, params, operation_auth)` function.
 */
export function renderAuthWiringPython(plan: AuthWiringPlan): string {
	if (!plan.enabled || plan.entries.length === 0) {
		return "    # No auth schemes declared in spec — no-op.\n    return\n";
	}

	const blocks: string[] = [];
	blocks.push(`    _auth_set = False`);
	for (const entry of plan.entries) {
		const idLit = JSON.stringify(entry.scheme.id);
		const gate = `    if _should_apply(${idLit}, operation_auth):`;
		if (entry.scheme.type === "http" && entry.passwordEnvVar) {
			blocks.push(
				`${gate}
        if not _auth_set:
            _user = os.environ.get(${JSON.stringify(entry.envVar)})
            _pass = os.environ.get(${JSON.stringify(entry.passwordEnvVar)})
            if _user is not None and _pass is not None:
                import base64
                _encoded = base64.b64encode(f"{_user}:{_pass}".encode("utf-8")).decode("ascii")
                headers[${JSON.stringify(entry.name)}] = "Basic " + _encoded
                _auth_set = True
            elif _user is not None or _pass is not None:
                import sys
                print(${JSON.stringify(`[auth] Partial basic-auth config: set both ${entry.envVar} and ${entry.passwordEnvVar}.`)}, file=sys.stderr)`,
			);
			continue;
		}
		if (
			entry.scheme.type === "http" &&
			entry.scheme.scheme?.toLowerCase() === "bearer"
		) {
			blocks.push(
				`${gate}
        if not _auth_set:
            _token = os.environ.get(${JSON.stringify(entry.envVar)})
            if _token:
                headers[${JSON.stringify(entry.name)}] = "Bearer " + _token
                _auth_set = True`,
			);
			continue;
		}
		if (entry.scheme.type === "oauth2") {
			blocks.push(
				`${gate}
        # oauth2 — token must be obtained externally; set ${entry.envVar} to a valid bearer token.
        if not _auth_set:
            _token = os.environ.get(${JSON.stringify(entry.envVar)})
            if _token:
                headers[${JSON.stringify(entry.name)}] = "Bearer " + _token
                _auth_set = True`,
			);
			continue;
		}
		// apiKey
		if (entry.in === "query") {
			blocks.push(
				`${gate}
        _key = os.environ.get(${JSON.stringify(entry.envVar)})
        if _key:
            params[${JSON.stringify(entry.name)}] = _key`,
			);
		} else {
			blocks.push(
				`${gate}
        _key = os.environ.get(${JSON.stringify(entry.envVar)})
        if _key:
            headers[${JSON.stringify(entry.name)}] = _key`,
			);
		}
	}

	return `${blocks.join("\n")}\n`;
}

/**
 * One-line top-of-file comment listing the env vars the auth wiring reads.
 */
export function renderAuthEnvVarBanner(
	plan: AuthWiringPlan,
	commentPrefix: string,
): string {
	if (!plan.enabled || plan.envVarSummary.length === 0) {
		return "";
	}
	return `${commentPrefix} Auth env vars (set before launching the server): ${plan.envVarSummary.join(", ")}.\n`;
}
