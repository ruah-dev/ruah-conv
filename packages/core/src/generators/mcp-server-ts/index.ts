import type { RuahToolSchema } from "../../ir/schema.js";
import type { GeneratorCapability } from "../capability.js";
import {
	buildDeferredCatalog,
	buildDeferredSchemas,
	buildDeferredToolDefinitions,
} from "../deferred.js";
import type { GenerateOptions, GenerateResult } from "../index.js";
import {
	type AuthWiringPlan,
	buildAuthWiringPlan,
	buildOperationSpecs,
	buildToolDefinitions,
	buildToolInputSchema,
	renderAuthEnvVarBanner,
	renderAuthWiringTs,
	renderDefaultAuthSchemesTs,
	renderEnvExample,
	type ToolDefinition,
} from "../shared.js";

export const capability: GeneratorCapability = {
	id: "mcp-ts-server",
	label: "MCP TypeScript Server",
	emits: "files",
	supportsTransport: true,
	supportsName: true,
	supportsDeferred: true,
};

export function generate(
	spec: RuahToolSchema,
	options: GenerateOptions = {},
): GenerateResult {
	const serverName =
		options.name ?? `${sanitizeName(spec.meta.title)} MCP Server`;
	const deferred = options.deferred === true;
	const toolDefs = deferred
		? buildDeferredToolDefinitions(spec)
		: buildToolDefinitions(spec);
	const operationSpecs = buildOperationSpecs(spec);
	const operations = spec.tools.map((tool) => {
		const { flattenedBody } = buildToolInputSchema(tool, spec);
		const operation = operationSpecs.find((entry) => entry.name === tool.name);
		if (!operation) {
			throw new Error(`Missing operation spec for tool "${tool.name}".`);
		}
		return {
			...operation,
			flattenedBody,
			auth: tool.auth ?? [],
		};
	});
	const authPlan = buildAuthWiringPlan(spec.auth, options.authWiring !== false);

	return {
		files: [
			{
				path: "package.json",
				language: "json",
				content: JSON.stringify(
					{
						name: sanitizePackageName(serverName),
						private: true,
						type: "module",
						scripts: {
							build: "tsc -p tsconfig.json",
							start: "node dist/index.js",
							"start:stdio": "node dist/index.js",
							"start:http": "node dist/http.js",
						},
						dependencies: {
							"@modelcontextprotocol/sdk": "^1.29.0",
							express: "^4.21.2",
							zod: "^3.25.76",
						},
						devDependencies: {
							"@types/express": "^5.0.3",
							"@types/node": "^24.6.0",
							typescript: "^6.0.2",
						},
					},
					null,
					2,
				),
			},
			{
				path: ".env.example",
				language: "yaml",
				content: renderEnvExample(authPlan, spec.meta.title),
			},
			{
				path: "tsconfig.json",
				language: "json",
				content: JSON.stringify(
					{
						compilerOptions: {
							target: "ES2022",
							module: "Node16",
							moduleResolution: "Node16",
							outDir: "dist",
							rootDir: "src",
							types: ["node"],
							strict: true,
							esModuleInterop: true,
							skipLibCheck: true,
						},
						include: ["src/**/*.ts"],
					},
					null,
					2,
				),
			},
			{
				path: "src/generated.ts",
				language: "typescript",
				content: buildSharedServerSource(
					serverName,
					spec.meta.baseUrl,
					toolDefs,
					operations,
					authPlan,
					deferred
						? {
								catalog: buildDeferredCatalog(spec),
								schemas: buildDeferredSchemas(spec),
							}
						: undefined,
				),
			},
			{
				path: "src/index.ts",
				language: "typescript",
				content: buildStdioEntrypoint(),
			},
			{
				path: "src/http.ts",
				language: "typescript",
				content: buildHttpServerSource(serverName),
			},
		],
		summary: {
			toolCount: toolDefs.length,
			typeCount: Object.keys(spec.types).length,
			targetId: "mcp-ts-server",
			warnings: deferred
				? [
						`deferred: ${spec.tools.length} operations behind search_tools / get_tool_schema / invoke_tool`,
					]
				: [],
		},
	};
}

function buildSharedServerSource(
	serverName: string,
	baseUrl: string | undefined,
	toolDefs: ToolDefinition[],
	operations: Array<Record<string, unknown>>,
	authPlan: AuthWiringPlan,
	deferred?: {
		catalog: ReturnType<typeof buildDeferredCatalog>;
		schemas: ReturnType<typeof buildDeferredSchemas>;
	},
): string {
	const registrations = deferred
		? buildDeferredRegistrations()
		: toolDefs
				.map((tool) => {
					const props =
						(tool.inputSchema.properties as Record<string, unknown>) ?? {};
					// The MCP TS SDK's registerTool config accepts a structured `_meta`
					// passthrough. We cast the config object to bypass version-skewed
					// type checks across SDK minor versions while still emitting the
					// metadata that downstream MCP clients can read off `tool._meta`.
					return `  server.registerTool(
    ${JSON.stringify(tool.name)},
    ({
      description: ${JSON.stringify(tool.description)},
      inputSchema: ${buildZodShape(props, (tool.inputSchema.required as string[]) ?? [])},
      _meta: ${JSON.stringify(tool._meta)}
    } as any),
    async (args) => invokeOperation(OPERATIONS[${JSON.stringify(tool.name)}] as Operation, args)
  );`;
				})
				.join("\n\n");
	const deferredTables = deferred
		? `
export const TOOL_CATALOG = ${JSON.stringify(deferred.catalog, null, 2)} as const;

export const TOOL_SCHEMAS: Record<string, { name: string; description: string; inputSchema: Record<string, unknown> }> = ${JSON.stringify(deferred.schemas, null, 2)};

function textResult(text: string, isError = false): CallToolResult {
  return { isError, content: [{ type: "text" as const, text }] };
}

// sync-with: generators/deferred.ts searchCatalog
function searchCatalog(query: string, limit: number) {
  const cap = Math.min(25, Math.max(1, Math.round(Number.isFinite(limit) ? limit : 10)));
  const needle = query.trim().toLowerCase();
  if (!needle) return TOOL_CATALOG.slice(0, cap);
  return TOOL_CATALOG
    .map((entry) => ({ entry, score: scoreCatalogEntry(entry, needle) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, cap)
    .map((row) => row.entry);
}

function scoreCatalogEntry(entry: (typeof TOOL_CATALOG)[number], needle: string): number {
  const name = entry.name.toLowerCase();
  const path = entry.path.toLowerCase();
  const description = entry.description.toLowerCase();
  if (name === needle) return 100;
  if (name.includes(needle)) return 80;
  if (path.includes(needle)) return 60;
  if (description.includes(needle)) return 40;
  return needle.split(/\\s+/).filter(Boolean).reduce((score, token) => {
    if (name.includes(token)) return score + 15;
    if (path.includes(token)) return score + 10;
    if (description.includes(token)) return score + 5;
    return score;
  }, 0);
}
`
		: "";

	const authBanner = renderAuthEnvVarBanner(authPlan, "//");
	const authBody = renderAuthWiringTs(authPlan);
	const defaultAuthSchemes = renderDefaultAuthSchemesTs(authPlan);

	return `${authBanner}import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const API_BASE_URL = process.env.API_BASE_URL ?? ${JSON.stringify(baseUrl ?? "http://localhost:3000")};

type ParamLocation = "query" | "path" | "header" | "cookie";

export type Operation = {
  name: string;
  description: string;
  method: string;
  path: string;
  parameters: ReadonlyArray<{ name: string; in: ParamLocation; required: boolean }>;
  requestBody?: { required: boolean; contentType: string; schema: unknown };
  flattenedBody: boolean;
  auth: ReadonlyArray<string>;
};

export const OPERATIONS: Record<string, Operation> = ${JSON.stringify(
		Object.fromEntries(
			operations.map((operation) => [operation.name, operation]),
		),
		null,
		2,
	)};
${deferredTables}
export function createServer() {
  const server = new McpServer({
    name: ${JSON.stringify(serverName)},
    version: "1.0.0"
  });

${registrations}

  return server;
}

async function invokeOperation(
  operation: Operation,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const url = new URL(interpolatePath(operation.path, args), API_BASE_URL);
  const headers: Record<string, string> = {};

  for (const param of operation.parameters) {
    const value = args[param.name];
    if (value === undefined || value === null) continue;
    if (param.in === "query") {
      url.searchParams.set(param.name, String(value));
    } else if (param.in === "header") {
      headers[param.name] = String(value);
    }
  }

  applyAuth(headers, url, operation.auth);

  let body: BodyInit | undefined;
  if (operation.requestBody) {
    const ct = operation.requestBody.contentType;
    if (operation.flattenedBody) {
      const payload: Record<string, unknown> = {};
      for (const key of Object.keys(args)) {
        if (!operation.parameters.some((param) => param.name === key)) {
          payload[key] = args[key];
        }
      }
      body = encodeRequestBody(ct, payload, headers);
    } else if (args.body !== undefined) {
      headers["content-type"] = ct;
      body =
        typeof args.body === "string"
          ? args.body
          : JSON.stringify(args.body);
    }
  }

  const response = await fetch(url, {
    method: operation.method,
    headers,
    body,
  });

  const text = await response.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Keep plain text responses as-is.
  }

  const output = JSON.stringify(
    {
      ok: response.ok,
      status: response.status,
      data,
    },
    null,
    2,
  );

  if (!response.ok) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: output }],
    };
  }

  return {
    content: [{ type: "text" as const, text: output }],
    structuredContent:
      typeof data === "object" && data !== null
        ? (data as { [key: string]: unknown })
        : undefined,
  };
}

function encodeRequestBody(
  contentType: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
): BodyInit | undefined {
  if (/^application\\/([^;]*\\+)?json(;|$)/.test(contentType)) {
    headers["content-type"] = contentType;
    return JSON.stringify(payload);
  }
  if (contentType.startsWith("application/x-www-form-urlencoded")) {
    headers["content-type"] = contentType;
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) usp.append(k, String(item));
      } else if (typeof v === "object") {
        // One-level bracketed encoding (Stripe-style: metadata[order_id]=foo).
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
          if (v2 === undefined || v2 === null) continue;
          usp.append(\`\${k}[\${k2}]\`, String(v2));
        }
      } else {
        usp.append(k, String(v));
      }
    }
    return usp.toString();
  }
  if (contentType.startsWith("multipart/form-data")) {
    // Let fetch set Content-Type with the boundary; do not set it explicitly.
    delete headers["content-type"];
    const fd = new FormData();
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) fd.append(k, item as string | Blob);
      } else if (typeof v === "object" && !(v instanceof Blob)) {
        fd.append(k, JSON.stringify(v));
      } else {
        fd.append(k, v as string | Blob);
      }
    }
    return fd;
  }
  if (contentType.startsWith("text/")) {
    headers["content-type"] = contentType;
    // Flattened bodies always come in as objects. Serialize as JSON with a warn
    // — callers wanting raw text should use a non-flattened body parameter.
    console.warn(
      \`[invokeOperation] text/* content-type with flattened object payload; serializing as JSON.\`,
    );
    return JSON.stringify(payload);
  }
  headers["content-type"] = contentType;
  console.warn(
    \`[invokeOperation] Unknown content-type '\${contentType}', falling back to JSON.stringify.\`,
  );
  return JSON.stringify(payload);
}

function interpolatePath(pathname: string, args: Record<string, unknown>) {
  return pathname.replace(/\\{([^}]+)\\}/g, (_, name) => {
    const value = args[name];
    if (value === undefined || value === null) {
      throw new Error(\`Missing path parameter: \${name}\`);
    }
    return encodeURIComponent(String(value));
  });
}

// Every auth scheme id declared in the spec. Used as a fallback when an
// operation declares no security requirement of its own.
const DEFAULT_AUTH_SCHEMES: ReadonlyArray<string> = ${defaultAuthSchemes};

function _shouldApply(
  schemeId: string,
  operationAuth: ReadonlyArray<string>,
): boolean {
  if (operationAuth.length === 0) {
    return DEFAULT_AUTH_SCHEMES.includes(schemeId);
  }
  return operationAuth.includes(schemeId);
}

function applyAuth(
  headers: Record<string, string>,
  url: URL,
  operationAuth: ReadonlyArray<string>,
) {
  // The \`url\` parameter is used when an auth scheme injects into the query
  // string (e.g. apiKey in: query). Suppress unused-var noise when only
  // header-based schemes are present.
  void url;
  void operationAuth;
${authBody}}
`;
}

function buildDeferredRegistrations(): string {
	return `  server.registerTool(
    "search_tools",
    ({
      description: "Search API operations by name, path, or description.",
      inputSchema: { query: z.string().optional(), limit: z.number().int().optional() }
    } as any),
    async (args) => textResult(JSON.stringify(searchCatalog(String(args.query ?? ""), Number(args.limit ?? 10)), null, 2))
  );

  server.registerTool(
    "get_tool_schema",
    ({
      description: "Load the full input schema for one operation.",
      inputSchema: { name: z.string() }
    } as any),
    async (args) => {
      const name = String(args.name ?? "");
      const schema = TOOL_SCHEMAS[name];
      if (!schema) {
        return textResult(JSON.stringify({ error: "unknown tool", name }), true);
      }
      return textResult(JSON.stringify(schema, null, 2));
    }
  );

  server.registerTool(
    "invoke_tool",
    ({
      description: "Invoke one API operation by name.",
      inputSchema: { name: z.string(), arguments: z.record(z.unknown()).optional() }
    } as any),
    async (args) => {
      const name = String(args.name ?? "");
      const operation = OPERATIONS[name];
      if (!operation) {
        return textResult(JSON.stringify({ error: "unknown tool", name }), true);
      }
      const payload = (args.arguments ?? {}) as Record<string, unknown>;
      return invokeOperation(operation, payload);
    }
  );`;
}

function buildStdioEntrypoint(): string {
	return `import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./generated.js";

const transport = new StdioServerTransport();
const server = createServer();

await server.connect(transport);
`;
}

function buildHttpServerSource(serverName: string): string {
	return `import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./generated.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.all("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  const server = createServer();

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(${JSON.stringify(serverName)} + " HTTP transport listening on :" + port);
});
`;
}

function buildZodShape(
	properties: Record<string, unknown>,
	required: string[],
): string {
	const lines = Object.entries(properties).map(([name, schema]) => {
		const isRequired = required.includes(name);
		return `${JSON.stringify(name)}: ${jsonSchemaToZod(schema, isRequired)}`;
	});
	return `{ ${lines.join(", ")} }`;
}

function jsonSchemaToZod(schema: unknown, required: boolean): string {
	const body = jsonSchemaToZodBase(schema);
	return required ? body : `${body}.optional()`;
}

function jsonSchemaToZodBase(schema: unknown): string {
	const jsonSchema = (schema as Record<string, unknown> | undefined) ?? {};

	if (Array.isArray(jsonSchema.enum)) {
		const literals = (jsonSchema.enum as unknown[]).map(
			(value) => `z.literal(${JSON.stringify(value)})`,
		);
		return literals.length === 1
			? literals[0]
			: `z.union([${literals.join(", ")}])`;
	}

	if (Array.isArray(jsonSchema.oneOf) || Array.isArray(jsonSchema.anyOf)) {
		const variants = (jsonSchema.oneOf ?? jsonSchema.anyOf) as unknown[];
		const mapped = variants.map((variant) => jsonSchemaToZodBase(variant));
		return mapped.length === 1 ? mapped[0] : `z.union([${mapped.join(", ")}])`;
	}

	if (jsonSchema.type === "array") {
		return `z.array(${jsonSchemaToZodBase(jsonSchema.items)})`;
	}

	if (jsonSchema.type === "object" || jsonSchema.properties) {
		const properties = (jsonSchema.properties as Record<string, unknown>) ?? {};
		const required = (jsonSchema.required as string[]) ?? [];
		return `z.object(${buildZodShape(properties, required)})`;
	}

	switch (jsonSchema.type) {
		case "integer":
			return "z.number().int()";
		case "number":
			return "z.number()";
		case "boolean":
			return "z.boolean()";
		case "string":
			return "z.string()";
		default:
			return "z.unknown()";
	}
}

function sanitizeName(value: string): string {
	return value.replace(/[^a-z0-9]+/gi, " ").trim();
}

function sanitizePackageName(value: string): string {
	return sanitizeName(value).toLowerCase().replace(/\s+/g, "-");
}
