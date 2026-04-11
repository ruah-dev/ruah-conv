import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { detectFormat, parse } from "../src/parsers/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Fixtures live in source tree — resolve from project root, not dist-test
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const PETSTORE = resolve(
	PROJECT_ROOT,
	"test",
	"fixtures",
	"clean",
	"petstore.yaml",
);
const SWAGGER = resolve(
	PROJECT_ROOT,
	"test",
	"fixtures",
	"swagger",
	"store.json",
);
const POSTMAN = resolve(
	PROJECT_ROOT,
	"test",
	"fixtures",
	"postman",
	"collection.json",
);
const GRAPHQL = resolve(
	PROJECT_ROOT,
	"test",
	"fixtures",
	"graphql",
	"schema.graphql",
);

describe("detectFormat", () => {
	it("detects OpenAPI 3.0", () => {
		const content = readFileSync(PETSTORE, "utf8");
		assert.equal(detectFormat(content), "openapi-3.0");
	});

	it("detects OpenAPI 3.1 from JSON", () => {
		const content = JSON.stringify({
			openapi: "3.1.0",
			info: { title: "Test", version: "1.0" },
			paths: {},
		});
		assert.equal(detectFormat(content), "openapi-3.1");
	});

	it("returns null for non-OpenAPI content", () => {
		assert.equal(detectFormat("just some text"), null);
	});

	it("detects Swagger 2.0", () => {
		const content = JSON.stringify({
			swagger: "2.0",
			info: { title: "Test", version: "1.0" },
		});
		assert.equal(detectFormat(content), "swagger-2.0");
	});

	it("detects Postman v2.1 collections", () => {
		const content = readFileSync(POSTMAN, "utf8");
		assert.equal(detectFormat(content), "postman-v2.1");
	});

	it("detects GraphQL SDL from file extension", () => {
		const content = readFileSync(GRAPHQL, "utf8");
		assert.equal(detectFormat(content, GRAPHQL), "graphql-sdl");
	});
});

describe("parse petstore.yaml", () => {
	it("parses without throwing", () => {
		const ir = parse(PETSTORE);
		assert.ok(ir);
	});

	it("extracts correct metadata", () => {
		const ir = parse(PETSTORE);
		assert.equal(ir.meta.title, "Petstore API");
		assert.equal(ir.meta.version, "1.0.0");
		assert.equal(ir.meta.sourceFormat, "openapi-3.0");
		assert.equal(ir.meta.baseUrl, "https://api.petstore.example.com/v1");
	});

	it("extracts auth schemes", () => {
		const ir = parse(PETSTORE);
		assert.equal(ir.auth.length, 1);
		assert.equal(ir.auth[0].id, "apiKeyAuth");
		assert.equal(ir.auth[0].type, "apiKey");
		assert.equal(ir.auth[0].in, "header");
		assert.equal(ir.auth[0].name, "X-API-Key");
	});

	it("extracts the correct number of tools", () => {
		const ir = parse(PETSTORE);
		// listPets, createPet, getPet, deletePet
		assert.equal(ir.tools.length, 4);
	});

	it("normalizes tool names from operationIds", () => {
		const ir = parse(PETSTORE);
		const names = ir.tools.map((t) => t.name);
		assert.ok(names.includes("listPets"));
		assert.ok(names.includes("createPet"));
		assert.ok(names.includes("getPet"));
		assert.ok(names.includes("deletePet"));
	});

	it("extracts query parameters for listPets", () => {
		const ir = parse(PETSTORE);
		const listPets = mustFindTool(ir, "listPets");
		assert.ok(listPets);
		assert.equal(listPets.parameters.length, 2);

		const limit = mustFindParameter(listPets, "limit");
		assert.equal(limit.in, "query");
		assert.equal(limit.required, false);
		assert.equal(limit.schema.kind, "integer");
	});

	it("extracts path parameters from shared path-level definition", () => {
		const ir = parse(PETSTORE);
		const getPet = mustFindTool(ir, "getPet");
		assert.ok(getPet);

		const petId = mustFindParameter(getPet, "petId");
		assert.ok(petId);
		assert.equal(petId.in, "path");
		assert.equal(petId.required, true);
	});

	it("extracts request body for createPet", () => {
		const ir = parse(PETSTORE);
		const createPet = mustFindTool(ir, "createPet");
		assert.ok(createPet.requestBody);
		assert.equal(createPet.requestBody.required, true);
		assert.equal(createPet.requestBody.contentType, "application/json");
		assert.equal(createPet.requestBody.schema.kind, "ref");
	});

	it("extracts named types from components/schemas", () => {
		const ir = parse(PETSTORE);
		assert.ok(ir.types.Pet);
		assert.ok(ir.types.NewPet);
		assert.ok(ir.types.Error);
		assert.equal(Object.keys(ir.types).length, 3);
	});

	it("classifies risk levels correctly", () => {
		const ir = parse(PETSTORE);
		const listPets = mustFindTool(ir, "listPets");
		const createPet = mustFindTool(ir, "createPet");
		const deletePet = mustFindTool(ir, "deletePet");

		assert.equal(listPets.riskLevel, "safe");
		assert.equal(createPet.riskLevel, "moderate");
		assert.equal(deletePet.riskLevel, "destructive");
	});

	it("marks read-only and idempotent correctly", () => {
		const ir = parse(PETSTORE);
		const listPets = mustFindTool(ir, "listPets");
		const createPet = mustFindTool(ir, "createPet");

		assert.equal(listPets.readOnly, true);
		assert.equal(listPets.idempotent, true);
		assert.equal(createPet.readOnly, false);
		assert.equal(createPet.idempotent, false);
	});

	it("resolves auth references on tools", () => {
		const ir = parse(PETSTORE);
		const listPets = mustFindTool(ir, "listPets");
		assert.ok(listPets.auth);
		assert.ok(listPets.auth.includes("apiKeyAuth"));
	});
});

describe("parse error cases", () => {
	it("throws for non-existent file", () => {
		assert.throws(() => parse("/does/not/exist.yaml"), /ENOENT/);
	});
});

describe("parse swagger 2.0", () => {
	it("auto-upgrades Swagger 2.0 into the shared IR", () => {
		const ir = parse(SWAGGER);

		assert.equal(ir.meta.sourceFormat, "swagger-2.0");
		assert.equal(ir.meta.baseUrl, "https://api.example.com/v1");
		assert.ok(ir.types.Item);
		assert.equal(ir.tools.length, 1);
		assert.equal(ir.tools[0].name, "listItems");
		assert.equal(ir.tools[0].pagination?.style, "offset-limit");
	});
});

describe("parse Postman collection", () => {
	it("extracts tools and auth", () => {
		const ir = parse(POSTMAN);

		assert.equal(ir.meta.sourceFormat, "postman-v2.1");
		assert.equal(ir.meta.baseUrl, "https://billing.example.com");
		assert.equal(ir.auth.length, 1);
		assert.equal(ir.tools.length, 2);
		assert.ok(ir.tools.some((tool) => tool.name === "listInvoices"));
		assert.ok(ir.tools.some((tool) => tool.name === "createInvoice"));
	});
});

describe("parse GraphQL SDL", () => {
	it("creates tools from queries and mutations", () => {
		const ir = parse(GRAPHQL);

		assert.equal(ir.meta.sourceFormat, "graphql-sdl");
		assert.equal(ir.tools.length, 3);
		assert.ok(ir.tools.some((tool) => tool.name === "listUsers"));
		assert.ok(ir.tools.some((tool) => tool.name === "getUser"));
		assert.ok(ir.tools.some((tool) => tool.name === "createUser"));
		assert.ok(ir.types.User);
		assert.ok(ir.types.CreateUserInput);
	});
});

function mustFindTool(ir: ReturnType<typeof parse>, name: string) {
	const tool = ir.tools.find((entry) => entry.name === name);
	assert.ok(tool, `expected tool "${name}" to exist`);
	return tool;
}

function mustFindParameter(
	tool: ReturnType<typeof mustFindTool>,
	name: string,
) {
	const parameter = tool.parameters.find((entry) => entry.name === name);
	assert.ok(parameter, `expected parameter "${name}" to exist`);
	return parameter;
}
