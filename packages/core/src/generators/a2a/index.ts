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
	const serviceName = options.name ?? `${spec.meta.title} A2A Wrapper`;
	const tools = buildToolDefinitions(spec);
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
						name: serviceName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
						private: true,
						type: "module",
						scripts: {
							start: "node src/index.js",
						},
					},
					null,
					2,
				),
			},
			{
				path: "src/index.js",
				language: "typescript",
				content: buildA2ASource(
					serviceName,
					spec.meta.baseUrl,
					tools,
					operations,
				),
			},
		],
		summary: {
			toolCount: spec.tools.length,
			typeCount: Object.keys(spec.types).length,
			targetId: "a2a-wrapper",
			warnings: [],
		},
	};
}

function buildA2ASource(
	serviceName: string,
	baseUrl: string | undefined,
	tools: Array<{
		name: string;
		description: string;
		inputSchema: Record<string, unknown>;
	}>,
	operations: Array<Record<string, unknown>>,
): string {
	return `import { createServer } from "node:http";

const API_BASE_URL = process.env.API_BASE_URL ?? ${JSON.stringify(baseUrl ?? "http://localhost:3000")};
const OPERATIONS = ${JSON.stringify(Object.fromEntries(operations.map((operation) => [operation.name, operation])), null, 2)};
const CAPABILITIES = ${JSON.stringify(
		tools.map((tool) => ({
			id: tool.name,
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
		})),
		null,
		2,
	)};

createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  if (req.method === "GET" && req.url === "/.well-known/agent.json") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        name: ${JSON.stringify(serviceName)},
        version: "1.0.0",
        skills: CAPABILITIES,
      }, null, 2),
    );
    return;
  }

  if (req.method === "POST" && req.url === "/invoke") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const operation = OPERATIONS[payload.skill];
    if (!operation) {
      res.writeHead(404).end(JSON.stringify({ error: "Unknown skill" }));
      return;
    }

    try {
      const result = await invokeOperation(operation, payload.input ?? {});
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, output: result }, null, 2));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ ok: false, error: String(error) }, null, 2));
    }
    return;
  }

  res.writeHead(404).end("Not found");
}).listen(Number(process.env.PORT ?? 8787), () => {
  console.log(${JSON.stringify(serviceName)} + " listening on :" + (process.env.PORT ?? "8787"));
});

async function invokeOperation(operation, args) {
  const url = new URL(interpolatePath(operation.path, args), API_BASE_URL);
  const headers = {};
  for (const param of operation.parameters) {
    const value = args[param.name];
    if (value === undefined || value === null) continue;
    if (param.in === "query") url.searchParams.set(param.name, String(value));
    if (param.in === "header") headers[param.name] = String(value);
  }

  applyAuth(headers);

  let body;
  if (operation.requestBody) {
    headers["content-type"] = operation.requestBody.contentType;
    if (operation.flattenedBody) {
      const payload = {};
      for (const [key, value] of Object.entries(args)) {
        if (!operation.parameters.some((param) => param.name === key)) {
          payload[key] = value;
        }
      }
      body = operation.requestBody.contentType.startsWith("application/json")
        ? JSON.stringify(payload)
        : String(args.body ?? "");
    } else {
      body = typeof args.body === "string" ? args.body : JSON.stringify(args.body ?? args);
    }
  }

  const response = await fetch(url, { method: operation.method, headers, body });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function interpolatePath(pathname, args) {
  return pathname.replace(/\\{([^}]+)\\}/g, (_, name) => {
    const value = args[name];
    if (value === undefined || value === null) {
      throw new Error("Missing path parameter: " + name);
    }
    return encodeURIComponent(String(value));
  });
}

function applyAuth(headers) {
  if (process.env.API_KEY) {
    headers["x-api-key"] = process.env.API_KEY;
  }
  if (process.env.BEARER_TOKEN) {
    headers.authorization = "Bearer " + process.env.BEARER_TOKEN;
  }
}
`;
}
