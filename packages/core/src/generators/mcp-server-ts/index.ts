import type { RuahToolSchema } from "../../ir/schema.js";
import type { GenerateOptions, GenerateResult } from "../index.js";
import {
	buildOperationSpecs,
	buildToolDefinitions,
	buildToolInputSchema,
} from "../shared.js";

export function generate(
	spec: RuahToolSchema,
	options: GenerateOptions = {},
): GenerateResult {
	const serverName =
		options.name ?? `${sanitizeName(spec.meta.title)} MCP Server`;
	const toolDefs = buildToolDefinitions(spec);
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
			toolCount: spec.tools.length,
			typeCount: Object.keys(spec.types).length,
			targetId: "mcp-ts-server",
			warnings: [],
		},
	};
}

function buildSharedServerSource(
	serverName: string,
	baseUrl: string | undefined,
	toolDefs: Array<{
		name: string;
		description: string;
		inputSchema: Record<string, unknown>;
	}>,
	operations: Array<Record<string, unknown>>,
): string {
	const registrations = toolDefs
		.map((tool) => {
			const props =
				(tool.inputSchema.properties as Record<string, unknown>) ?? {};
			return `  server.registerTool(
    ${JSON.stringify(tool.name)},
    {
      description: ${JSON.stringify(tool.description)},
      inputSchema: ${buildZodShape(props, (tool.inputSchema.required as string[]) ?? [])}
    },
    async (args) => invokeOperation(OPERATIONS[${JSON.stringify(tool.name)}] as Operation, args)
  );`;
		})
		.join("\n\n");

	return `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

  applyAuth(headers);

  let body: string | undefined;
  if (operation.requestBody) {
    headers["content-type"] = operation.requestBody.contentType;
    if (operation.flattenedBody) {
      const payload: Record<string, unknown> = {};
      for (const key of Object.keys(args)) {
        if (!operation.parameters.some((param) => param.name === key)) {
          payload[key] = args[key];
        }
      }
      body = operation.requestBody.contentType.startsWith("application/json")
        ? JSON.stringify(payload)
        : String((args.body ?? payload) as string);
    } else if (args.body !== undefined) {
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

function interpolatePath(pathname: string, args: Record<string, unknown>) {
  return pathname.replace(/\\{([^}]+)\\}/g, (_, name) => {
    const value = args[name];
    if (value === undefined || value === null) {
      throw new Error(\`Missing path parameter: \${name}\`);
    }
    return encodeURIComponent(String(value));
  });
}

function applyAuth(headers: Record<string, string>) {
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const bearer = process.env.BEARER_TOKEN;
  if (bearer) {
    headers.authorization = \`Bearer \${bearer}\`;
  }
}
`;
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
