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
import { parse } from "../src/parsers/index.js";

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
});

describe("generate errors", () => {
	it("throws for unknown target", () => {
		const ir = parse(PETSTORE);
		assert.throws(() => generate("nonexistent", ir), /Unknown target/);
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
			}),
		);

		const config = loadConfig(specFile, undefined);
		assert.equal(config.target, "openai-tools");
		assert.equal(config.output, "./generated");
		assert.equal(config.name, "Configured Server");
	});
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
