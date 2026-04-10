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

	it("returns null for Swagger 2.0", () => {
		const content = JSON.stringify({
			swagger: "2.0",
			info: { title: "Test", version: "1.0" },
		});
		assert.equal(detectFormat(content), null);
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
		const listPets = ir.tools.find((t) => t.name === "listPets")!;
		assert.ok(listPets);
		assert.equal(listPets.parameters.length, 2);

		const limit = listPets.parameters.find((p) => p.name === "limit")!;
		assert.equal(limit.in, "query");
		assert.equal(limit.required, false);
		assert.equal(limit.schema.kind, "integer");
	});

	it("extracts path parameters from shared path-level definition", () => {
		const ir = parse(PETSTORE);
		const getPet = ir.tools.find((t) => t.name === "getPet")!;
		assert.ok(getPet);

		const petId = getPet.parameters.find((p) => p.name === "petId")!;
		assert.ok(petId);
		assert.equal(petId.in, "path");
		assert.equal(petId.required, true);
	});

	it("extracts request body for createPet", () => {
		const ir = parse(PETSTORE);
		const createPet = ir.tools.find((t) => t.name === "createPet")!;
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
		const listPets = ir.tools.find((t) => t.name === "listPets")!;
		const createPet = ir.tools.find((t) => t.name === "createPet")!;
		const deletePet = ir.tools.find((t) => t.name === "deletePet")!;

		assert.equal(listPets.riskLevel, "safe");
		assert.equal(createPet.riskLevel, "moderate");
		assert.equal(deletePet.riskLevel, "destructive");
	});

	it("marks read-only and idempotent correctly", () => {
		const ir = parse(PETSTORE);
		const listPets = ir.tools.find((t) => t.name === "listPets")!;
		const createPet = ir.tools.find((t) => t.name === "createPet")!;

		assert.equal(listPets.readOnly, true);
		assert.equal(listPets.idempotent, true);
		assert.equal(createPet.readOnly, false);
		assert.equal(createPet.idempotent, false);
	});

	it("resolves auth references on tools", () => {
		const ir = parse(PETSTORE);
		const listPets = ir.tools.find((t) => t.name === "listPets")!;
		assert.ok(listPets.auth);
		assert.ok(listPets.auth.includes("apiKeyAuth"));
	});
});

describe("parse error cases", () => {
	it("throws for non-existent file", () => {
		assert.throws(() => parse("/does/not/exist.yaml"), /ENOENT/);
	});
});
