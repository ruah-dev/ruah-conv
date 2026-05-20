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
import re
import sys
from typing import Any
from urllib.parse import quote, urlencode

import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP(${JSON.stringify(serverName)}, stateless_http=True, json_response=True)
API_BASE_URL = os.environ.get("API_BASE_URL", ${JSON.stringify(baseUrl ?? "http://localhost:3000")})
OPERATIONS = ${toPythonLiteral(Object.fromEntries(operations.map((operation) => [operation.name, operation])))}


def apply_auth(headers: dict[str, str], params: dict[str, Any]) -> None:
${authBody}

_JSON_CT_RE = re.compile(r"^application/([^;]*\\+)?json(;|$)")


def encode_request_body(
    content_type: str,
    payload: dict[str, Any],
    headers: dict[str, str],
) -> tuple[Any, Any, Any, Any]:
    """Encode \`payload\` according to \`content_type\`.

    Returns a tuple of (json_body, content_body, files_body, data_body)
    matching httpx.AsyncClient.request kwargs. Exactly one (or none) is
    non-None.
    """
    if _JSON_CT_RE.match(content_type):
        headers["Content-Type"] = content_type
        return payload, None, None, None
    if content_type.startswith("application/x-www-form-urlencoded"):
        headers["Content-Type"] = content_type
        items: list[tuple[str, str]] = []
        for k, v in payload.items():
            if v is None:
                continue
            if isinstance(v, dict):
                # One-level bracketed encoding (Stripe-style: metadata[order_id]=foo).
                for k2, v2 in v.items():
                    if v2 is None:
                        continue
                    items.append((f"{k}[{k2}]", str(v2)))
            elif isinstance(v, (list, tuple)):
                for item in v:
                    if item is None:
                        continue
                    items.append((k, str(item)))
            else:
                items.append((k, str(v)))
        return None, urlencode(items, doseq=True), None, None
    if content_type.startswith("multipart/form-data"):
        # Let httpx set Content-Type with the boundary.
        headers.pop("Content-Type", None)
        files: list[tuple[str, Any]] = []
        for k, v in payload.items():
            if v is None:
                continue
            if isinstance(v, (dict, list)):
                files.append((k, (None, json.dumps(v), "application/json")))
            elif isinstance(v, (bytes, bytearray)):
                files.append((k, (k, bytes(v), "application/octet-stream")))
            else:
                files.append((k, (None, str(v))))
        return None, None, files, None
    if content_type.startswith("text/"):
        headers["Content-Type"] = content_type
        print(
            "[invoke_operation] text/* content-type with flattened object payload; serializing as JSON.",
            file=sys.stderr,
        )
        return None, json.dumps(payload), None, None
    headers["Content-Type"] = content_type
    print(
        f"[invoke_operation] Unknown content-type '{content_type}', falling back to JSON.",
        file=sys.stderr,
    )
    return None, json.dumps(payload), None, None


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

    json_body: Any = None
    content_body: Any = None
    files_body: Any = None
    data_body: Any = None
    if operation.get("requestBody"):
        ct = operation["requestBody"]["contentType"]
        if operation.get("flattenedBody"):
            payload = {
                key: value
                for key, value in args.items()
                if key not in {param["name"] for param in operation["parameters"]} and value is not None
            }
            json_body, content_body, files_body, data_body = encode_request_body(ct, payload, headers)
        elif args.get("body") is not None:
            headers["Content-Type"] = ct
            value = args["body"]
            if isinstance(value, (dict, list)):
                json_body = value
            else:
                content_body = value if isinstance(value, (str, bytes)) else str(value)

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.request(
            operation["method"],
            url,
            params=params,
            headers=headers,
            json=json_body,
            content=content_body,
            data=data_body,
            files=files_body,
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
