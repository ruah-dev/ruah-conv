import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { loadConfig } from "../src/config.js";
import { generate, getTargets } from "../src/generators/index.js";
import type { RuahToolSchema, Tool } from "../src/ir/schema.js";
import { parse } from "../src/parsers/index.js";
import { writeGeneratedFiles as writeGeneratedFilesGuarded } from "../src/utils/write-files.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const PETSTORE = resolve(
	PROJECT_ROOT,
	"test",
	"fixtures",
	"clean",
	"petstore.yaml",
);
const GRAPHQL = resolve(
	PROJECT_ROOT,
	"test",
	"fixtures",
	"graphql",
	"schema.graphql",
);

describe("getTargets", () => {
	it("lists available targets", () => {
		const targets = getTargets();
		assert.ok(targets.length > 0);
		assert.ok(targets.some((t) => t.id === "mcp-tool-defs"));
		assert.ok(targets.some((t) => t.id === "mcp-ts-server"));
		assert.ok(targets.some((t) => t.id === "mcp-python-server"));
		assert.ok(targets.some((t) => t.id === "openai-tools"));
		assert.ok(targets.some((t) => t.id === "anthropic-tools"));
		assert.ok(targets.some((t) => t.id === "a2a-wrapper"));
		assert.ok(targets.some((t) => t.id === "claude-code-plugin-ts"));
		assert.ok(targets.some((t) => t.id === "codex-plugin-ts"));
	});
});

describe("generate mcp-tool-defs", () => {
	it("generates valid JSON output", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-tool-defs", ir);

		assert.ok(result.files.length > 0);
		const toolsFile = result.files.find((f) => f.path === "tools.json");
		assert.ok(toolsFile);

		// Must be valid JSON
		const tools = JSON.parse(toolsFile.content) as Array<
			Record<string, unknown>
		>;
		assert.ok(Array.isArray(tools));
	});

	it("generates one tool per operation", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-tool-defs", ir);
		const tools = JSON.parse(result.files[0].content) as Array<
			Record<string, unknown>
		>;

		assert.equal(tools.length, 4); // listPets, createPet, getPet, deletePet
	});

	it("each tool has name, description, inputSchema", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-tool-defs", ir);
		const tools = JSON.parse(result.files[0].content) as Array<
			Record<string, unknown>
		>;

		for (const tool of tools) {
			assert.ok(typeof tool.name === "string", `tool name should be string`);
			assert.ok(
				typeof tool.description === "string",
				`tool description should be string`,
			);
			assert.ok(tool.inputSchema, `tool should have inputSchema`);
			assert.equal(
				(tool.inputSchema as Record<string, unknown>).type,
				"object",
			);
		}
	});

	it("includes query params as inputSchema properties", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-tool-defs", ir);
		const tools = JSON.parse(result.files[0].content) as Array<
			Record<string, unknown>
		>;

		const listPets = tools.find((t) => t.name === "listPets");
		assert.ok(listPets);

		const schema = listPets.inputSchema as Record<string, unknown>;
		const props = schema.properties as Record<string, unknown>;
		assert.ok(props.limit, "should have limit property");
		assert.ok(props.offset, "should have offset property");
	});

	it("includes path params as required inputSchema properties", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-tool-defs", ir);
		const tools = JSON.parse(result.files[0].content) as Array<
			Record<string, unknown>
		>;

		const getPet = tools.find((t) => t.name === "getPet");
		assert.ok(getPet);

		const schema = getPet.inputSchema as Record<string, unknown>;
		const props = schema.properties as Record<string, unknown>;
		assert.ok(props.petId, "should have petId property");

		const required = schema.required as string[];
		assert.ok(required.includes("petId"));
	});

	it("flattens request body object properties into inputSchema", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-tool-defs", ir);
		const tools = JSON.parse(result.files[0].content) as Array<
			Record<string, unknown>
		>;

		const createPet = tools.find((t) => t.name === "createPet");
		assert.ok(createPet);

		const schema = createPet.inputSchema as Record<string, unknown>;
		const props = schema.properties as Record<string, unknown>;
		// NewPet's properties (name, tag) should be flattened in
		assert.ok(props.name, "should have name property from request body");
	});

	it("reports correct summary", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-tool-defs", ir);

		assert.equal(result.summary.toolCount, 4);
		assert.equal(result.summary.typeCount, 3);
		assert.equal(result.summary.targetId, "mcp-tool-defs");
	});

	it("applies the read-only operation profile", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-tool-defs", ir, {
			operationProfile: "read-only",
		});
		const tools = JSON.parse(result.files[0].content) as Array<
			Record<string, unknown>
		>;

		assert.deepEqual(
			tools.map((tool) => tool.name),
			["listPets", "getPet"],
		);
		assert.equal(result.summary.toolCount, 2);
	});

	it("applies the standard operation profile", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-tool-defs", ir, {
			operationProfile: "standard",
		});
		const tools = JSON.parse(result.files[0].content) as Array<
			Record<string, unknown>
		>;

		assert.deepEqual(
			tools.map((tool) => tool.name),
			["listPets", "createPet", "getPet"],
		);
		assert.equal(result.summary.toolCount, 3);
	});
});

describe("semantic correctness — JSON targets", () => {
	for (const target of ["mcp-tool-defs", "openai-tools", "anthropic-tools"]) {
		describe(target, () => {
			function loadTools(): Array<Record<string, unknown>> {
				const ir = parse(PETSTORE);
				const result = generate(target, ir);
				return JSON.parse(result.files[0].content) as Array<
					Record<string, unknown>
				>;
			}

			function pickToolByName(
				tools: Array<Record<string, unknown>>,
				name: string,
			): Record<string, unknown> {
				// openai-tools wraps under `function`; others put name on the root.
				const direct = tools.find((t) => t.name === name);
				if (direct) return direct;
				const wrapped = tools.find(
					(t) =>
						typeof t.function === "object" &&
						t.function !== null &&
						(t.function as Record<string, unknown>).name === name,
				);
				assert.ok(wrapped, `expected to find tool ${name}`);
				return wrapped.function as Record<string, unknown>;
			}

			function getSchema(
				tool: Record<string, unknown>,
			): Record<string, unknown> {
				// mcp-tool-defs uses inputSchema; anthropic uses input_schema; openai (after pick) uses parameters.
				return (tool.inputSchema ??
					tool.input_schema ??
					tool.parameters) as Record<string, unknown>;
			}

			function getDescription(tool: Record<string, unknown>): string {
				return tool.description as string;
			}

			it("required:true source params surface in inputSchema.required", () => {
				const tools = loadTools();
				const getPet = pickToolByName(tools, "getPet");
				const schema = getSchema(getPet);
				assert.deepEqual(schema.required, ["petId"]);
			});

			it("integer params preserve minimum/maximum constraints", () => {
				const tools = loadTools();
				const listPets = pickToolByName(tools, "listPets");
				const schema = getSchema(listPets);
				const props = schema.properties as Record<
					string,
					Record<string, unknown>
				>;
				assert.equal(props.limit.type, "integer");
				assert.equal(props.limit.minimum, 1);
				assert.equal(props.limit.maximum, 100);
			});

			it("enum values propagate through to the JSON schema", () => {
				// Inline spec — petstore exposes enums only on response schemas, so
				// we synthesize a minimal spec where an enum lives on an input
				// parameter to assert preservation through every JSON target.
				const enumSpec: RuahToolSchema = {
					meta: {
						title: "Status API",
						version: "1.0.0",
						sourceFormat: "openapi-3.0",
						sourceFile: "inline.yaml",
						generatedAt: new Date().toISOString(),
						baseUrl: "https://example.com",
					},
					auth: [],
					types: {},
					tools: [
						{
							name: "filterPets",
							description: "Filter pets by status",
							method: "GET",
							path: "/pets",
							parameters: [
								{
									name: "status",
									in: "query",
									required: false,
									description: "Availability status",
									schema: {
										kind: "enum",
										values: ["available", "pending", "sold"],
									},
								},
							],
							responses: [],
							idempotent: true,
							readOnly: true,
							riskLevel: "safe",
						},
					],
				};

				const result = generate(target, enumSpec);
				const content = result.files[0].content;
				assert.match(
					content,
					/"enum":\s*\[\s*"available",\s*"pending",\s*"sold"\s*\]/,
					"expected enum values to be preserved verbatim",
				);
			});

			it("destructive operations carry a risk marker in the description", () => {
				const tools = loadTools();
				const deletePet = pickToolByName(tools, "deletePet");
				const description = getDescription(deletePet);
				assert.match(
					description,
					/destructive/i,
					"DELETE operations must surface the destructive risk label",
				);
			});

			it("paginated operations surface pagination hints in the description", () => {
				const tools = loadTools();
				const listPets = pickToolByName(tools, "listPets");
				const description = getDescription(listPets);
				assert.match(
					description,
					/pagination|offset|cursor/i,
					"paginated operations must surface pagination metadata in the description",
				);
			});
		});
	}
});

describe("semantic correctness — scaffold targets", () => {
	it("mcp-ts-server OPERATIONS map contains every tool by name", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-ts-server", ir, { name: "Petstore Server" });
		const generatedTs = result.files.find((f) => f.path === "src/generated.ts");
		assert.ok(generatedTs);
		for (const tool of ir.tools) {
			assert.ok(
				generatedTs.content.includes(`"${tool.name}"`) ||
					generatedTs.content.includes(`'${tool.name}'`),
				`expected ${tool.name} to appear in src/generated.ts`,
			);
		}
	});

	it("claude-code plugin scaffold lists every tool in the generated server", () => {
		const ir = parse(PETSTORE);
		const result = generate("claude-code-plugin-ts", ir, {
			name: "Petstore Plugin",
		});
		const generatedTs = result.files.find((f) => f.path === "src/generated.ts");
		assert.ok(generatedTs);
		for (const tool of ir.tools) {
			assert.ok(
				generatedTs.content.includes(`"${tool.name}"`) ||
					generatedTs.content.includes(`'${tool.name}'`),
				`expected ${tool.name} to appear in src/generated.ts`,
			);
		}
	});
});

describe("generator capabilities", () => {
	it("every registered target has a capability descriptor", async () => {
		const { getCapability } = await import("../src/generators/index.js");
		for (const target of getTargets()) {
			const cap = getCapability(target.id);
			assert.ok(cap, `expected capability for target ${target.id}`);
			assert.equal(cap?.id, target.id);
			assert.ok(cap?.label.length > 0);
			assert.ok(cap?.emits === "json" || cap?.emits === "files");
		}
	});

	it("classifies JSON vs file-emitting targets", async () => {
		const { getCapability } = await import("../src/generators/index.js");
		assert.equal(getCapability("mcp-tool-defs")?.emits, "json");
		assert.equal(getCapability("openai-tools")?.emits, "json");
		assert.equal(getCapability("anthropic-tools")?.emits, "json");
		assert.equal(getCapability("mcp-ts-server")?.emits, "files");
		assert.equal(getCapability("mcp-python-server")?.emits, "files");
		assert.equal(getCapability("a2a-wrapper")?.emits, "files");
		assert.equal(getCapability("claude-code-plugin-ts")?.emits, "files");
		assert.equal(getCapability("codex-plugin-ts")?.emits, "files");
	});

	it("supportsTransport reflects which scaffolds run a server", async () => {
		const { getCapability } = await import("../src/generators/index.js");
		assert.equal(getCapability("mcp-tool-defs")?.supportsTransport, false);
		assert.equal(getCapability("openai-tools")?.supportsTransport, false);
		assert.equal(getCapability("anthropic-tools")?.supportsTransport, false);
		assert.equal(getCapability("mcp-ts-server")?.supportsTransport, true);
		assert.equal(getCapability("mcp-python-server")?.supportsTransport, true);
		assert.equal(getCapability("a2a-wrapper")?.supportsTransport, false);
	});
});

describe("CLI flag validation", () => {
	const CLI = resolve(PROJECT_ROOT, "dist", "cli.js");

	it("rejects --transport when the target does not support it", () => {
		const cli = spawnSync(
			process.execPath,
			[
				CLI,
				"generate",
				PETSTORE,
				"--target",
				"mcp-tool-defs",
				"--transport",
				"stdio",
			],
			{ encoding: "utf8" },
		);
		assert.notEqual(cli.status, 0);
		assert.match(cli.stderr, /--transport is not supported/);
	});

	it("rejects --json for multi-file targets", () => {
		const cli = spawnSync(
			process.execPath,
			[CLI, "generate", PETSTORE, "--target", "mcp-ts-server", "--json"],
			{ encoding: "utf8" },
		);
		assert.notEqual(cli.status, 0);
		assert.match(cli.stderr, /--json is not supported for multi-file target/);
	});

	it("warns (does not error) when --name is passed to a target that ignores it", () => {
		const cli = spawnSync(
			process.execPath,
			[
				CLI,
				"generate",
				PETSTORE,
				"--target",
				"mcp-tool-defs",
				"--name",
				"Cosmetic Name",
				"--json",
			],
			{ encoding: "utf8" },
		);
		assert.equal(cli.status, 0, cli.stderr);
		assert.match(cli.stderr, /--name has no effect/);
	});
});

describe("generate errors", () => {
	it("throws for unknown target", () => {
		const ir = parse(PETSTORE);
		assert.throws(() => generate("nonexistent", ir), /Unknown target/);
	});

	it("throws when the selected operation profile excludes every operation", () => {
		const ir = buildSpec([
			makeTool("deletePet", "DELETE"),
			makeTool("updatePet", "PATCH"),
		]);

		assert.throws(
			() =>
				generate("mcp-tool-defs", ir, {
					operationProfile: "standard",
				}),
			/No operations matched the "standard" operation profile/,
		);
	});
});

describe("generate new roadmap targets", () => {
	it("generates OpenAI tool definitions", () => {
		const ir = parse(PETSTORE);
		const result = generate("openai-tools", ir);
		const tools = JSON.parse(result.files[0].content) as Array<
			Record<string, unknown>
		>;

		assert.equal(tools[0].type, "function");
		assert.ok((tools[0].function as Record<string, unknown>).parameters);
	});

	it("generates Anthropic tool definitions", () => {
		const ir = parse(PETSTORE);
		const result = generate("anthropic-tools", ir);
		const tools = JSON.parse(result.files[0].content) as Array<
			Record<string, unknown>
		>;

		assert.ok(tools[0].input_schema);
	});

	it("generates a TypeScript MCP server scaffold", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-ts-server", ir, { name: "Petstore Server" });

		assert.ok(result.files.some((file) => file.path === "src/generated.ts"));
		assert.ok(result.files.some((file) => file.path === "src/index.ts"));
		assert.ok(result.files.some((file) => file.path === "src/http.ts"));

		const packageFile = result.files.find(
			(file) => file.path === "package.json",
		);
		assert.ok(packageFile);
		const pkg = JSON.parse(packageFile.content) as {
			dependencies: Record<string, string>;
			devDependencies: Record<string, string>;
		};
		assert.ok(pkg.dependencies.express);
		assert.ok(pkg.devDependencies["@types/node"]);
		assert.ok(pkg.devDependencies["@types/express"]);

		for (const file of result.files.filter((file) =>
			file.path.endsWith(".ts"),
		)) {
			const transpiled = ts.transpileModule(file.content, {
				compilerOptions: {
					module: ts.ModuleKind.Node16,
					target: ts.ScriptTarget.ES2022,
				},
				reportDiagnostics: true,
				fileName: file.path,
			});
			assert.equal(
				transpiled.diagnostics?.length ?? 0,
				0,
				`expected ${file.path} to transpile without syntax diagnostics`,
			);
		}

		// Regression: generated.ts must typecheck under strict mode (the SDK
		// is strict, and `as const` over OPERATIONS previously narrowed param
		// types so badly that `param.in === "header"` was flagged as
		// unreachable). Assert the shape the fix produces:
		const generatedTs = result.files.find(
			(file) => file.path === "src/generated.ts",
		);
		assert.ok(generatedTs);
		assert.match(
			generatedTs.content,
			/export type Operation = \{/,
			"OPERATIONS must be typed via an explicit Operation interface — `as const` over-narrows parameter `in` and `requestBody` under strict typecheck",
		);
		assert.match(
			generatedTs.content,
			/OPERATIONS: Record<string, Operation>/,
			"OPERATIONS must be widened via Record<string, Operation>, not `as const`",
		);
		assert.doesNotMatch(
			generatedTs.content,
			/OPERATIONS = \{[\s\S]*\} as const;/,
			"OPERATIONS must NOT use `as const` (over-narrows under strict typecheck)",
		);
		assert.match(
			generatedTs.content,
			/Promise<CallToolResult>/,
			"invokeOperation must return Promise<CallToolResult> to satisfy the SDK callback signature",
		);
		assert.match(
			generatedTs.content,
			/type: "text" as const/,
			'content blocks must use `type: "text" as const` to avoid widening to `string`',
		);
	});

	it("respects the standard profile in the TypeScript MCP server scaffold", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-ts-server", ir, {
			name: "Petstore Server",
			operationProfile: "standard",
		});
		const generatedFile = result.files.find(
			(file) => file.path === "src/generated.ts",
		);
		assert.ok(generatedFile);
		assert.match(generatedFile.content, /createPet/);
		assert.doesNotMatch(generatedFile.content, /deletePet/);
		assert.equal(result.summary.toolCount, 3);
	});

	it("generates a Python MCP server scaffold", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-python-server", ir, {
			name: "Petstore Server",
		});

		assert.ok(result.files.some((file) => file.path === "server.py"));
		assert.ok(result.files.some((file) => file.path === "pyproject.toml"));

		const dir = writeGeneratedFiles(result.files);
		const python = spawnSync(
			"python3",
			["-m", "py_compile", resolve(dir, "server.py")],
			{
				encoding: "utf8",
			},
		);
		assert.equal(python.status, 0, python.stderr);
	});

	it("generates an A2A wrapper scaffold", () => {
		const ir = parse(GRAPHQL);
		const result = generate("a2a-wrapper", ir);

		assert.ok(result.files.some((file) => file.path === "src/index.js"));

		const dir = writeGeneratedFiles(result.files);
		const nodeCheck = spawnSync(
			"node",
			["--check", resolve(dir, "src/index.js")],
			{
				encoding: "utf8",
			},
		);
		assert.equal(nodeCheck.status, 0, nodeCheck.stderr);
	});

	it("generates a Claude Code plugin scaffold", () => {
		const ir = parse(PETSTORE);
		const result = generate("claude-code-plugin-ts", ir, {
			name: "Petstore Plugin",
		});

		assert.ok(
			result.files.some((file) => file.path === ".claude-plugin/plugin.json"),
		);
		assert.ok(result.files.some((file) => file.path === ".mcp.json"));

		const manifestFile = result.files.find(
			(file) => file.path === ".claude-plugin/plugin.json",
		);
		assert.ok(manifestFile);
		const manifest = JSON.parse(manifestFile.content) as {
			name: string;
			mcpServers: string;
		};
		assert.equal(manifest.name, "petstore-plugin");
		assert.equal(manifest.mcpServers, "./.mcp.json");

		const mcpFile = result.files.find((file) => file.path === ".mcp.json");
		assert.ok(mcpFile);
		const mcpConfig = JSON.parse(mcpFile.content) as {
			mcpServers: Record<
				string,
				{
					type: string;
					command: string;
					args: string[];
					env: Record<string, string>;
				}
			>;
		};
		assert.equal(mcpConfig.mcpServers["petstore-plugin"].type, "stdio");
		assert.equal(mcpConfig.mcpServers["petstore-plugin"].command, "node");
		assert.equal(
			mcpConfig.mcpServers["petstore-plugin"].args[0],
			String.raw`\${CLAUDE_PLUGIN_ROOT}/dist/index.js`,
		);

		for (const file of result.files.filter((file) =>
			file.path.endsWith(".ts"),
		)) {
			const transpiled = ts.transpileModule(file.content, {
				compilerOptions: {
					module: ts.ModuleKind.Node16,
					target: ts.ScriptTarget.ES2022,
				},
				reportDiagnostics: true,
				fileName: file.path,
			});
			assert.equal(
				transpiled.diagnostics?.length ?? 0,
				0,
				`expected ${file.path} to transpile without syntax diagnostics`,
			);
		}
	});

	it("respects the standard profile in plugin output", () => {
		const ir = parse(PETSTORE);
		const result = generate("codex-plugin-ts", ir, {
			name: "Petstore Plugin",
			operationProfile: "standard",
		});

		const manifestFile = result.files.find(
			(file) => file.path === ".codex-plugin/plugin.json",
		);
		assert.ok(manifestFile);
		assert.match(manifestFile.content, /3 API tools/);
		assert.equal(result.summary.toolCount, 3);
	});

	it("generates a Codex plugin scaffold", () => {
		const ir = parse(PETSTORE);
		const result = generate("codex-plugin-ts", ir, {
			name: "Petstore Plugin",
		});

		assert.ok(
			result.files.some((file) => file.path === ".codex-plugin/plugin.json"),
		);
		assert.ok(result.files.some((file) => file.path === ".mcp.json"));

		const manifestFile = result.files.find(
			(file) => file.path === ".codex-plugin/plugin.json",
		);
		assert.ok(manifestFile);
		const manifest = JSON.parse(manifestFile.content) as {
			name: string;
			mcpServers: string;
			interface: { displayName: string; defaultPrompt: string[] };
		};
		assert.equal(manifest.name, "petstore-plugin");
		assert.equal(manifest.mcpServers, "./.mcp.json");
		assert.equal(manifest.interface.displayName, "Petstore Plugin");
		assert.equal(manifest.interface.defaultPrompt.length, 3);

		const mcpFile = result.files.find((file) => file.path === ".mcp.json");
		assert.ok(mcpFile);
		const mcpConfig = JSON.parse(mcpFile.content) as {
			mcpServers: Record<
				string,
				{
					type: string;
					command: string;
					args: string[];
					env: Record<string, string>;
				}
			>;
		};
		assert.equal(mcpConfig.mcpServers["petstore-plugin"].type, "stdio");
		assert.equal(mcpConfig.mcpServers["petstore-plugin"].command, "node");
		assert.equal(
			mcpConfig.mcpServers["petstore-plugin"].args[0],
			"./dist/index.js",
		);
		assert.ok(result.summary.warnings.length > 0);
	});
});

describe("runtime auth wiring", () => {
	it("mcp-ts-server emits the spec's apiKey header + env var by default", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-ts-server", ir, { name: "Petstore" });
		const generated = result.files.find((f) => f.path === "src/generated.ts");
		assert.ok(generated);
		assert.match(generated.content, /API_KEY/);
		assert.match(generated.content, /X-API-Key/);
		// applyAuth is called with both headers and url so query-param schemes
		// work too.
		assert.match(generated.content, /applyAuth\(headers, url\)/);
	});

	it("mcp-ts-server omits auth wiring when authWiring is false", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-ts-server", ir, {
			name: "Petstore",
			authWiring: false,
		});
		const generated = result.files.find((f) => f.path === "src/generated.ts");
		assert.ok(generated);
		assert.doesNotMatch(generated.content, /process\.env\["API_KEY"\]/);
		assert.doesNotMatch(generated.content, /X-API-Key/);
		// The applyAuth function still exists (stub) so the call site stays
		// stable — the body is a no-op comment.
		assert.match(generated.content, /No auth schemes declared/);
	});

	it("mcp-python-server emits the spec's apiKey header + env var by default", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-python-server", ir, { name: "Petstore" });
		const py = result.files.find((f) => f.path === "server.py");
		assert.ok(py);
		assert.match(py.content, /API_KEY/);
		assert.match(py.content, /X-API-Key/);
		assert.match(py.content, /def apply_auth/);
		// Uses os.environ.get (no KeyError on missing).
		assert.match(py.content, /os\.environ\.get\("API_KEY"\)/);
	});

	it("mcp-python-server omits auth wiring when authWiring is false", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-python-server", ir, {
			name: "Petstore",
			authWiring: false,
		});
		const py = result.files.find((f) => f.path === "server.py");
		assert.ok(py);
		assert.doesNotMatch(py.content, /os\.environ\.get\("API_KEY"\)/);
		assert.doesNotMatch(py.content, /X-API-Key/);
	});

	it("a2a wrapper emits the spec's apiKey header + env var by default", () => {
		const ir = parse(PETSTORE);
		const result = generate("a2a-wrapper", ir);
		const src = result.files.find((f) => f.path === "src/index.js");
		assert.ok(src);
		assert.match(src.content, /API_KEY/);
		assert.match(src.content, /X-API-Key/);
		assert.match(src.content, /applyAuth\(headers, url\)/);
	});

	it("a2a wrapper omits auth wiring when authWiring is false", () => {
		const ir = parse(PETSTORE);
		const result = generate("a2a-wrapper", ir, { authWiring: false });
		const src = result.files.find((f) => f.path === "src/index.js");
		assert.ok(src);
		assert.doesNotMatch(src.content, /process\.env\["API_KEY"\]/);
		assert.doesNotMatch(src.content, /X-API-Key/);
	});

	it("plugin-ts targets inherit auth wiring from the mcp-ts-server scaffold", () => {
		const ir = parse(PETSTORE);
		const result = generate("claude-code-plugin-ts", ir, {
			name: "Petstore Plugin",
		});
		const generated = result.files.find((f) => f.path === "src/generated.ts");
		assert.ok(generated);
		assert.match(generated.content, /API_KEY/);
		assert.match(generated.content, /X-API-Key/);
	});

	it("bearer auth synthesizes Authorization header + BEARER_TOKEN env var", () => {
		const bearerSpec: RuahToolSchema = {
			meta: {
				title: "Bearer API",
				version: "1.0.0",
				sourceFormat: "openapi-3.0",
				sourceFile: "inline.yaml",
				generatedAt: new Date().toISOString(),
				baseUrl: "https://example.com",
			},
			auth: [
				{
					id: "bearerAuth",
					type: "http",
					scheme: "bearer",
				},
			],
			types: {},
			tools: [makeTool("listThings", "GET")],
		};
		const result = generate("mcp-ts-server", bearerSpec);
		const generated = result.files.find((f) => f.path === "src/generated.ts");
		assert.ok(generated);
		assert.match(generated.content, /BEARER_TOKEN/);
		assert.match(generated.content, /Authorization/);
		assert.match(generated.content, /Bearer/);
	});

	it("basic auth synthesizes BASIC_AUTH_USER + BASIC_AUTH_PASS env vars", () => {
		const basicSpec: RuahToolSchema = {
			meta: {
				title: "Basic API",
				version: "1.0.0",
				sourceFormat: "openapi-3.0",
				sourceFile: "inline.yaml",
				generatedAt: new Date().toISOString(),
				baseUrl: "https://example.com",
			},
			auth: [
				{
					id: "basicAuth",
					type: "http",
					scheme: "basic",
				},
			],
			types: {},
			tools: [makeTool("listThings", "GET")],
		};
		const result = generate("mcp-ts-server", basicSpec);
		const generated = result.files.find((f) => f.path === "src/generated.ts");
		assert.ok(generated);
		assert.match(generated.content, /BASIC_AUTH_USER/);
		assert.match(generated.content, /BASIC_AUTH_PASS/);
		assert.match(generated.content, /Basic/);
	});

	it("oauth2 emits a placeholder bearer with OAUTH_TOKEN", () => {
		const oauthSpec: RuahToolSchema = {
			meta: {
				title: "OAuth API",
				version: "1.0.0",
				sourceFormat: "openapi-3.0",
				sourceFile: "inline.yaml",
				generatedAt: new Date().toISOString(),
				baseUrl: "https://example.com",
			},
			auth: [{ id: "oauth", type: "oauth2" }],
			types: {},
			tools: [makeTool("listThings", "GET")],
		};
		const result = generate("mcp-ts-server", oauthSpec);
		const generated = result.files.find((f) => f.path === "src/generated.ts");
		assert.ok(generated);
		assert.match(generated.content, /OAUTH_TOKEN/);
		assert.match(generated.content, /obtained externally/);
	});

	it("no auth schemes => no auth code regardless of flag", () => {
		const noAuthSpec: RuahToolSchema = {
			meta: {
				title: "Open API",
				version: "1.0.0",
				sourceFormat: "openapi-3.0",
				sourceFile: "inline.yaml",
				generatedAt: new Date().toISOString(),
				baseUrl: "https://example.com",
			},
			auth: [],
			types: {},
			tools: [makeTool("listThings", "GET")],
		};
		for (const authWiring of [true, false, undefined]) {
			const result = generate("mcp-ts-server", noAuthSpec, { authWiring });
			const generated = result.files.find((f) => f.path === "src/generated.ts");
			assert.ok(generated);
			assert.doesNotMatch(generated.content, /BEARER_TOKEN/);
			assert.doesNotMatch(generated.content, /process\.env\["API_KEY"\]/);
			assert.doesNotMatch(generated.content, /OAUTH_TOKEN/);
		}
	});

	it("apiKey-in-query injects into url.searchParams (not headers)", () => {
		const querySpec: RuahToolSchema = {
			meta: {
				title: "Query API",
				version: "1.0.0",
				sourceFormat: "openapi-3.0",
				sourceFile: "inline.yaml",
				generatedAt: new Date().toISOString(),
				baseUrl: "https://example.com",
			},
			auth: [
				{
					id: "queryKey",
					type: "apiKey",
					in: "query",
					name: "access_token",
				},
			],
			types: {},
			tools: [makeTool("listThings", "GET")],
		};
		const result = generate("mcp-ts-server", querySpec);
		const generated = result.files.find((f) => f.path === "src/generated.ts");
		assert.ok(generated);
		assert.match(generated.content, /url\.searchParams\.set\("access_token"/);
	});

	it("generated TS auth wiring still transpiles under strict mode", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-ts-server", ir, { name: "Petstore" });
		const generated = result.files.find((f) => f.path === "src/generated.ts");
		assert.ok(generated);
		const transpiled = ts.transpileModule(generated.content, {
			compilerOptions: {
				module: ts.ModuleKind.Node16,
				target: ts.ScriptTarget.ES2022,
			},
			reportDiagnostics: true,
			fileName: "src/generated.ts",
		});
		assert.equal(
			transpiled.diagnostics?.length ?? 0,
			0,
			"generated.ts with auth wiring must transpile cleanly",
		);
	});
});

describe("config loading", () => {
	it("loads generation defaults from a JSON config file", () => {
		const dir = mkdtempSync(resolve(tmpdir(), "ruah-conv-config-"));
		const specFile = resolve(dir, "spec.yaml");
		const configFile = resolve(dir, "ruah.conv.json");

		writeFileSync(
			specFile,
			"openapi: 3.0.0\ninfo:\n  title: Test\n  version: 1.0.0\npaths: {}\n",
		);
		writeFileSync(
			configFile,
			JSON.stringify({
				target: "openai-tools",
				output: "./generated",
				name: "Configured Server",
				operationProfile: "read-only",
			}),
		);

		const config = loadConfig(specFile, undefined);
		assert.equal(config.target, "openai-tools");
		assert.equal(config.output, "./generated");
		assert.equal(config.name, "Configured Server");
		assert.equal(config.operationProfile, "read-only");
	});
});

describe("generate CLI writes nested output paths", () => {
	const CLI = resolve(PROJECT_ROOT, "dist", "cli.js");

	for (const target of [
		"mcp-ts-server",
		"a2a-wrapper",
		"claude-code-plugin-ts",
		"codex-plugin-ts",
	]) {
		it(`creates parent directories when generating ${target}`, () => {
			const outDir = mkdtempSync(resolve(tmpdir(), `ruah-conv-cli-${target}-`));
			const spec = target === "a2a-wrapper" ? GRAPHQL : PETSTORE;

			const cli = spawnSync(
				process.execPath,
				[CLI, "generate", spec, "--target", target, "--output", outDir],
				{ encoding: "utf8" },
			);

			assert.equal(
				cli.status,
				0,
				`CLI failed for ${target}:\nstdout:\n${cli.stdout}\nstderr:\n${cli.stderr}`,
			);
		});
	}
});

function writeGeneratedFiles(
	files: Array<{ path: string; content: string }>,
): string {
	const dir = mkdtempSync(resolve(tmpdir(), "ruah-conv-generated-"));
	for (const file of files) {
		const target = resolve(dir, file.path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, file.content, "utf8");
	}
	return dir;
}

function buildSpec(tools: Tool[]): RuahToolSchema {
	return {
		meta: {
			title: "Test API",
			version: "1.0.0",
			sourceFormat: "openapi-3.0",
			sourceFile: "test.yaml",
			generatedAt: new Date().toISOString(),
			baseUrl: "https://example.com",
		},
		auth: [],
		tools,
		types: {},
	};
}

function makeTool(name: string, method: Tool["method"]): Tool {
	return {
		name,
		description: `${method} ${name}`,
		method,
		path: `/${name}`,
		parameters: [],
		responses: [],
		idempotent: method !== "POST" && method !== "PATCH",
		readOnly: method === "GET" || method === "HEAD" || method === "OPTIONS",
		riskLevel:
			method === "GET" || method === "HEAD" || method === "OPTIONS"
				? "safe"
				: method === "PATCH" || method === "DELETE"
					? "destructive"
					: "moderate",
	};
}

describe("identifier safety", () => {
	const MALICIOUS_TOOL_NAME =
		"x):\n    import os\n    os.system('pwned')\n    def y(z";
	const MALICIOUS_BODY_KEY = 'y"; import sys';

	function buildMaliciousSpec(): RuahToolSchema {
		const tool: Tool = {
			name: MALICIOUS_TOOL_NAME,
			description: "malicious",
			method: "POST",
			path: "/things",
			parameters: [],
			requestBody: {
				required: true,
				contentType: "application/json",
				schema: {
					kind: "object",
					properties: {
						[MALICIOUS_BODY_KEY]: { type: { kind: "string" } },
						safe_field: { type: { kind: "string" } },
					},
					required: [],
				},
			},
			responses: [],
			idempotent: false,
			readOnly: false,
			riskLevel: "moderate",
		};
		return buildSpec([tool]);
	}

	it("Python generator sanitizes tool name and body keys, blocking code injection", () => {
		const spec = buildMaliciousSpec();
		const result = generate("mcp-python-server", spec);
		const server = result.files.find((f) => f.path === "server.py");
		if (!server) throw new Error("expected server.py");
		const src = server.content;

		// The decorator line carries the raw name as a JSON-quoted string —
		// that's fine. We only need to ensure the injected payload never appears
		// as parseable top-level Python code.
		const decoratorIdx = src.indexOf("@mcp.tool");
		assert.ok(decoratorIdx >= 0, "expected decorator block");
		const codeAfterDecorator = src.slice(decoratorIdx);

		// Strip the JSON-quoted `name=...` and `description=...` so we don't
		// false-positive on the raw payload that's safely inside a string.
		const codeWithoutStrings = codeAfterDecorator
			.replace(/name="[^"]*"/g, "")
			.replace(/description="[^"]*"/g, "")
			.replace(/OPERATIONS\["[^"]*"\]/g, "")
			.replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '""');

		assert.ok(
			!codeWithoutStrings.includes("import os"),
			"sanitizer failed: 'import os' injected into Python source",
		);
		assert.ok(
			!codeWithoutStrings.includes("os.system"),
			"sanitizer failed: 'os.system' injected into Python source",
		);
		assert.ok(
			!codeWithoutStrings.includes("import sys"),
			"sanitizer failed: 'import sys' injected into Python source",
		);

		// And the def line must be a clean identifier.
		const defMatch = src.match(/async def (\S+?)\(/);
		if (!defMatch) throw new Error("expected async def line");
		const defName = defMatch[1];
		assert.match(
			defName,
			/^[A-Za-z_][A-Za-z0-9_]*$/,
			`def name not a valid Python identifier: ${defName}`,
		);
	});

	it("Python generator URL-encodes path params (quote import + usage)", () => {
		const spec = buildSpec([
			{
				name: "get_thing",
				description: "get",
				method: "GET",
				path: "/things/{id}",
				parameters: [
					{
						name: "id",
						in: "path",
						required: true,
						schema: { kind: "string" },
					},
				],
				responses: [],
				idempotent: true,
				readOnly: true,
				riskLevel: "safe",
			},
		]);
		const result = generate("mcp-python-server", spec);
		const server = result.files.find((f) => f.path === "server.py");
		if (!server) throw new Error("expected server.py");
		assert.match(
			server.content,
			/from urllib\.parse import quote/,
			"expected `from urllib.parse import quote` import",
		);
		assert.match(
			server.content,
			/quote\(str\([^)]+\), safe=""\)/,
			"expected quote(str(value), safe='') usage in path interpolation",
		);
	});

	it("TS generator does not emit injected top-level statements", () => {
		const spec = buildMaliciousSpec();
		const result = generate("mcp-ts-server", spec);
		const generated = result.files.find((f) => f.path === "src/generated.ts");
		if (!generated) throw new Error("expected src/generated.ts");
		const src = generated.content;
		// The TS generator routes every spec-derived value through JSON.stringify,
		// so payload text may legitimately appear inside string literals. Strip
		// string literals first, then assert the payload does not appear as code.
		const codeWithoutStrings = src
			.replace(/"(?:[^"\\]|\\.)*"/g, '""')
			.replace(/'(?:[^'\\]|\\.)*'/g, "''")
			.replace(/`(?:[^`\\]|\\.)*`/g, "``");
		assert.ok(
			!codeWithoutStrings.includes("os.system"),
			"payload 'os.system' escaped a string literal in TS source",
		);
		assert.ok(
			!codeWithoutStrings.includes("import sys"),
			"payload 'import sys' escaped a string literal in TS source",
		);
		// Parse and confirm the source still tokenizes — a successful parse with
		// no syntax errors means the malicious key didn't escape its string.
		const sourceFile = ts.createSourceFile(
			"generated.ts",
			src,
			ts.ScriptTarget.ES2022,
			true,
		);
		const syntacticDiagnostics = (
			sourceFile as unknown as {
				parseDiagnostics?: ReadonlyArray<ts.Diagnostic>;
			}
		).parseDiagnostics;
		assert.ok(
			!syntacticDiagnostics || syntacticDiagnostics.length === 0,
			"TS generator produced source with parse errors — possible injection",
		);
	});
});

describe("body encoding per content-type", () => {
	function buildBodySpec(contentType: string): RuahToolSchema {
		return buildSpec([
			{
				name: "submit",
				description: "submit form",
				method: "POST",
				path: "/submit",
				parameters: [],
				requestBody: {
					required: true,
					contentType,
					schema: {
						kind: "object",
						properties: {
							amount: { type: { kind: "integer" } },
							currency: { type: { kind: "string" } },
						},
						required: ["amount", "currency"],
					},
				},
				responses: [],
				idempotent: false,
				readOnly: false,
				riskLevel: "moderate",
			},
		]);
	}

	it("mcp-ts-server form-urlencoded uses URLSearchParams, not String(payload)", () => {
		const result = generate(
			"mcp-ts-server",
			buildBodySpec("application/x-www-form-urlencoded"),
		);
		const generated = result.files.find((f) => f.path === "src/generated.ts");
		assert.ok(generated);
		assert.match(generated.content, /URLSearchParams/);
		// The bug we are fixing: the old code did `String((args.body ?? payload))`
		// which produced "[object Object]" for objects.
		assert.doesNotMatch(generated.content, /String\(\(args\.body/);
		// Bracket-style nested encoding for one-level dicts.
		assert.match(generated.content, /\[\$\{k2\}\]/);
	});

	it("mcp-ts-server multipart uses FormData and strips content-type", () => {
		const result = generate(
			"mcp-ts-server",
			buildBodySpec("multipart/form-data"),
		);
		const generated = result.files.find((f) => f.path === "src/generated.ts");
		assert.ok(generated);
		assert.match(generated.content, /new FormData\(\)/);
		// Must delete the header so fetch sets it with the boundary.
		assert.match(generated.content, /delete headers\["content-type"\]/);
	});

	it("mcp-ts-server application/vnd.api+json is treated as JSON", () => {
		const result = generate(
			"mcp-ts-server",
			buildBodySpec("application/vnd.api+json"),
		);
		const generated = result.files.find((f) => f.path === "src/generated.ts");
		assert.ok(generated);
		// The JSON regex must match +json variants.
		assert.match(
			generated.content,
			/\/\^application\\\/\(\[\^;\]\*\\\+\)\?json\(;\|\$\)\//,
		);
	});

	it("mcp-ts-server body variable type widens to BodyInit", () => {
		const result = generate(
			"mcp-ts-server",
			buildBodySpec("multipart/form-data"),
		);
		const generated = result.files.find((f) => f.path === "src/generated.ts");
		assert.ok(generated);
		assert.match(generated.content, /let body: BodyInit \| undefined/);
	});

	it("mcp-python-server form-urlencoded uses urlencode, not json.dumps", () => {
		const result = generate(
			"mcp-python-server",
			buildBodySpec("application/x-www-form-urlencoded"),
		);
		const server = result.files.find((f) => f.path === "server.py");
		assert.ok(server);
		assert.match(server.content, /from urllib\.parse import quote, urlencode/);
		assert.match(server.content, /urlencode\(items, doseq=True\)/);
		// Bracketed nested keys (Stripe-style).
		assert.match(server.content, /f"\{k\}\[\{k2\}\]"/);
	});

	it("mcp-python-server multipart pops Content-Type so httpx sets boundary", () => {
		const result = generate(
			"mcp-python-server",
			buildBodySpec("multipart/form-data"),
		);
		const server = result.files.find((f) => f.path === "server.py");
		assert.ok(server);
		assert.match(server.content, /headers\.pop\("Content-Type", None\)/);
	});

	it("mcp-python-server JSON regex matches +json variants", () => {
		const result = generate(
			"mcp-python-server",
			buildBodySpec("application/vnd.api+json"),
		);
		const server = result.files.find((f) => f.path === "server.py");
		assert.ok(server);
		assert.match(server.content, /_JSON_CT_RE = re\.compile/);
		assert.match(server.content, /\[\^;\]\*\\\+/);
	});

	it("a2a wrapper form-urlencoded uses URLSearchParams, not String(args.body)", () => {
		const result = generate(
			"a2a-wrapper",
			buildBodySpec("application/x-www-form-urlencoded"),
		);
		const src = result.files.find((f) => f.path === "src/index.js");
		assert.ok(src);
		assert.match(src.content, /URLSearchParams/);
		assert.doesNotMatch(src.content, /String\(args\.body \?\? ""\)/);
	});

	it("a2a wrapper multipart deletes content-type", () => {
		const result = generate(
			"a2a-wrapper",
			buildBodySpec("multipart/form-data"),
		);
		const src = result.files.find((f) => f.path === "src/index.js");
		assert.ok(src);
		assert.match(src.content, /new FormData\(\)/);
		assert.match(src.content, /delete headers\["content-type"\]/);
	});

	it("plugin-ts inherits the body-encoding fix from mcp-ts-server", () => {
		const result = generate(
			"claude-code-plugin-ts",
			buildBodySpec("application/x-www-form-urlencoded"),
			{ name: "Test Plugin" },
		);
		const generated = result.files.find((f) => f.path === "src/generated.ts");
		assert.ok(generated);
		assert.match(generated.content, /URLSearchParams/);
		assert.doesNotMatch(generated.content, /String\(\(args\.body/);
	});
});

describe("writeGeneratedFiles path traversal guard", () => {
	it("rejects relative ../ paths", () => {
		const dir = mkdtempSync(resolve(tmpdir(), "ruah-conv-traversal-"));
		assert.throws(
			() =>
				writeGeneratedFilesGuarded(
					[{ path: "../escape.txt", content: "x" }],
					dir,
				),
			/Refusing to write outside/,
		);
	});

	it("rejects absolute paths outside the output directory", () => {
		const dir = mkdtempSync(resolve(tmpdir(), "ruah-conv-traversal-"));
		const escapeTarget = resolve(tmpdir(), "ruah-conv-escape-target.txt");
		assert.throws(
			() =>
				writeGeneratedFilesGuarded([{ path: escapeTarget, content: "x" }], dir),
			/Refusing to write outside/,
		);
	});

	it("accepts nested paths under the output directory", () => {
		const dir = mkdtempSync(resolve(tmpdir(), "ruah-conv-traversal-"));
		const written = writeGeneratedFilesGuarded(
			[{ path: "subdir/file.txt", content: "ok" }],
			dir,
		);
		assert.equal(written.length, 1);
		assert.ok(written[0].startsWith(resolve(dir)));
	});
});
