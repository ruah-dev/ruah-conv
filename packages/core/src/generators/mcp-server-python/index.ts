import type { RuahToolSchema } from "../../ir/schema.js";
import type { GeneratorCapability } from "../capability.js";
import type { GenerateOptions, GenerateResult } from "../index.js";
import {
	type AuthWiringPlan,
	buildAuthWiringPlan,
	buildOperationSpecs,
	buildToolDefinitions,
	buildToolInputSchema,
	renderAuthEnvVarBanner,
	renderAuthWiringPython,
	toSafePythonIdent,
} from "../shared.js";

export const capability: GeneratorCapability = {
	id: "mcp-python-server",
	label: "MCP Python Server",
	emits: "files",
	supportsTransport: true,
	supportsName: true,
};

export function generate(
	spec: RuahToolSchema,
	options: GenerateOptions = {},
): GenerateResult {
	const serverName = options.name ?? `${spec.meta.title} MCP Server`;
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
		};
	});
	const tools = buildToolDefinitions(spec);
	const authPlan = buildAuthWiringPlan(spec.auth, options.authWiring !== false);

	return {
		files: [
			{
				path: "pyproject.toml",
				language: "yaml",
				content: buildPyproject(serverName),
			},
			{
				path: "server.py",
				language: "python",
				content: buildPythonServer(
					serverName,
					spec.meta.baseUrl,
					tools,
					operations,
					authPlan,
				),
			},
		],
		summary: {
			toolCount: spec.tools.length,
			typeCount: Object.keys(spec.types).length,
			targetId: "mcp-python-server",
			warnings: [],
		},
	};
}

function buildPyproject(serverName: string): string {
	return `[project]
name = "${serverName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "mcp>=1.7.0",
  "httpx>=0.27.0",
]

[project.scripts]
start = "server:main"
`;
}

function buildPythonServer(
	serverName: string,
	baseUrl: string | undefined,
	tools: Array<{
		name: string;
		description: string;
		inputSchema: Record<string, unknown>;
	}>,
	operations: Array<Record<string, unknown>>,
	authPlan: AuthWiringPlan,
): string {
	const decorators = tools
		.map((tool, toolIndex) => {
			const props =
				(tool.inputSchema.properties as Record<string, unknown>) ?? {};
			const required = new Set((tool.inputSchema.required as string[]) ?? []);
			const usedIdents = new Set<string>();
			const propEntries = Object.entries(props).map(([name, schema], i) => {
				let safe = toSafePythonIdent(name, `arg_${i}`);
				// Guarantee uniqueness in case two distinct keys sanitize to the
				// same Python identifier (e.g. "a.b" and "a-b" both → "a_b").
				let suffix = 0;
				while (usedIdents.has(safe)) {
					suffix += 1;
					safe = `${toSafePythonIdent(name, `arg_${i}`)}_${suffix}`;
				}
				usedIdents.add(safe);
				return { original: name, safe, schema };
			});
			const safeFnName = toSafePythonIdent(tool.name, `op_${toolIndex}`);
			const args = propEntries
				.map(
					(entry) =>
						`${entry.safe}: ${jsonSchemaToPythonType(entry.schema)}${required.has(entry.original) ? "" : " | None = None"}`,
				)
				.join(", ");
			const payloadEntries = propEntries
				.map((entry) => `${JSON.stringify(entry.original)}: ${entry.safe}`)
				.join(", ");
			return `@mcp.tool(name=${JSON.stringify(tool.name)}, description=${JSON.stringify(tool.description)})
async def ${safeFnName}(${args}) -> str:
    payload = {${payloadEntries}}
    return await invoke_operation(OPERATIONS[${JSON.stringify(tool.name)}], payload)
`;
		})
		.join("\n");

	const authBanner = renderAuthEnvVarBanner(authPlan, "#");
	const authBody = renderAuthWiringPython(authPlan);

	return `${authBanner}from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import quote

import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP(${JSON.stringify(serverName)}, stateless_http=True, json_response=True)
API_BASE_URL = os.environ.get("API_BASE_URL", ${JSON.stringify(baseUrl ?? "http://localhost:3000")})
OPERATIONS = ${toPythonLiteral(Object.fromEntries(operations.map((operation) => [operation.name, operation])))}


def apply_auth(headers: dict[str, str], params: dict[str, Any]) -> None:
${authBody}

async def invoke_operation(operation: dict[str, Any], args: dict[str, Any]) -> str:
    url = API_BASE_URL.rstrip("/") + interpolate_path(operation["path"], args)
    params: dict[str, Any] = {}
    headers: dict[str, str] = {}

    for param in operation["parameters"]:
        value = args.get(param["name"])
        if value is None:
            continue
        if param["in"] == "query":
            params[param["name"]] = value
        elif param["in"] == "header":
            headers[param["name"]] = str(value)

    apply_auth(headers, params)

    body = None
    if operation.get("requestBody"):
        headers["Content-Type"] = operation["requestBody"]["contentType"]
        if operation.get("flattenedBody"):
            body = {
                key: value
                for key, value in args.items()
                if key not in {param["name"] for param in operation["parameters"]} and value is not None
            }
        elif args.get("body") is not None:
            body = args["body"]

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.request(
            operation["method"],
            url,
            params=params,
            headers=headers,
            json=body if headers.get("Content-Type", "").startswith("application/json") else None,
            content=body if isinstance(body, str) else None,
        )

    try:
        data = response.json()
    except Exception:
        data = response.text

    return json.dumps(
        {
            "ok": response.is_success,
            "status": response.status_code,
            "data": data,
        },
        indent=2,
    )


def interpolate_path(path: str, args: dict[str, Any]) -> str:
    # quote(..., safe="") percent-encodes "/" and "?" so an attacker-controlled
    # arg cannot break out of its path segment.
    result = path
    for key, value in args.items():
        result = result.replace("{" + key + "}", quote(str(value), safe=""))
    return result


${decorators}

def main() -> None:
    transport = os.environ.get("MCP_TRANSPORT", "stdio")
    mcp.run(transport=transport)


if __name__ == "__main__":
    main()
`;
}

function jsonSchemaToPythonType(schema: unknown): string {
	const jsonSchema = (schema as Record<string, unknown> | undefined) ?? {};

	if (Array.isArray(jsonSchema.enum)) {
		return "str";
	}

	if (jsonSchema.type === "integer") {
		return "int";
	}
	if (jsonSchema.type === "number") {
		return "float";
	}
	if (jsonSchema.type === "boolean") {
		return "bool";
	}
	if (jsonSchema.type === "array") {
		return "list[Any]";
	}
	if (jsonSchema.type === "object" || jsonSchema.properties) {
		return "dict[str, Any]";
	}
	return "str";
}

function toPythonLiteral(value: unknown): string {
	return JSON.stringify(value, null, 2)
		.replace(/\btrue\b/g, "True")
		.replace(/\bfalse\b/g, "False")
		.replace(/\bnull\b/g, "None");
}
