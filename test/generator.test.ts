import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
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

describe("getTargets", () => {
	it("lists available targets", () => {
		const targets = getTargets();
		assert.ok(targets.length > 0);
		assert.ok(targets.some((t) => t.id === "mcp-tool-defs"));
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
