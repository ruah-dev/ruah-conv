import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { validateIR } from "../src/ir/validate.js";
import { detectFormat, parse, SpecParseError } from "../src/parsers/index.js";

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
const HAR_SAMPLE = resolve(
	PROJECT_ROOT,
	"test",
	"fixtures",
	"har",
	"sample.har",
);
const OPENAPI_REF_PARAMS = resolve(
	PROJECT_ROOT,
	"test",
	"fixtures",
	"openapi",
	"ref-params.yaml",
);
const OPENAPI_REF_PARAMS_BROKEN = resolve(
	PROJECT_ROOT,
	"test",
	"fixtures",
	"openapi",
	"ref-params-broken.yaml",
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

	it("classifies PATCH operations as destructive", () => {
		const dir = mkdtempSync(resolve(tmpdir(), "ruah-conv-parser-"));
		const specFile = resolve(dir, "patch.yaml");
		writeFileSync(
			specFile,
			[
				'openapi: "3.0.3"',
				"info:",
				"  title: Patch API",
				'  version: "1.0.0"',
				"paths:",
				"  /pets/{petId}:",
				"    patch:",
				"      operationId: updatePet",
				"      requestBody:",
				"        required: true",
				"        content:",
				"          application/json:",
				"            schema:",
				"              type: object",
				"              properties:",
				"                tag:",
				"                  type: string",
				"      responses:",
				'        "200":',
				"          description: Updated",
			].join("\n"),
			"utf8",
		);

		const ir = parse(specFile);
		const updatePet = mustFindTool(ir, "updatePet");
		assert.equal(updatePet.riskLevel, "destructive");
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
	it("throws SpecParseError for non-existent file", () => {
		assert.throws(
			() => parse("/does/not/exist.yaml"),
			(err: unknown) => {
				assert.ok(err instanceof SpecParseError, "expected SpecParseError");
				assert.equal(err.path, "/does/not/exist.yaml");
				assert.equal(err.format, "unknown");
				assert.ok(err.cause, "expected cause to be populated");
				return true;
			},
		);
	});

	it("throws SpecParseError for malformed YAML", () => {
		const malformed = resolve(
			PROJECT_ROOT,
			"test",
			"fixtures",
			"errors",
			"malformed.yaml",
		);
		assert.throws(
			() => parse(malformed),
			(err: unknown) => {
				assert.ok(err instanceof SpecParseError, "expected SpecParseError");
				assert.equal(err.path, malformed);
				// Either format detection failed entirely ("unknown") or parsing
				// failed after partial detection — both are valid here. What matters
				// is the wrapper class and the path are correct.
				assert.ok(
					err.format === "unknown" || typeof err.format === "string",
					`unexpected format on error: ${String(err.format)}`,
				);
				assert.ok(err.message.includes(malformed));
				return true;
			},
		);
	});

	it("produces unresolved-ref warning for broken $ref", () => {
		const brokenRef = resolve(
			PROJECT_ROOT,
			"test",
			"fixtures",
			"errors",
			"broken-ref.yaml",
		);
		const ir = parse(brokenRef);
		const warnings = validateIR(ir);
		const unresolved = warnings.filter((w) => w.code === "unresolved-ref");
		assert.ok(
			unresolved.length > 0,
			"expected at least one unresolved-ref warning",
		);
		assert.ok(
			unresolved.some((w) => w.message.includes("DoesNotExist")),
			"expected warning to reference the missing schema name",
		);
	});

	it("falls back to 'Untitled API' when info.title is missing", () => {
		const missingTitle = resolve(
			PROJECT_ROOT,
			"test",
			"fixtures",
			"errors",
			"missing-info-title.yaml",
		);
		const ir = parse(missingTitle);
		assert.equal(ir.meta.title, "Untitled API");
		// Parsing should still succeed and produce at least one tool.
		assert.ok(ir.tools.length > 0);
	});
});

describe("parse GraphQL error paths", () => {
	it("emits unsupported-graphql-type for union types and undefined refs", () => {
		const circular = resolve(
			PROJECT_ROOT,
			"test",
			"fixtures",
			"errors",
			"circular.graphql",
		);
		const ir = parse(circular);
		const warnings = validateIR(ir);
		const unsupported = warnings.filter(
			(w) => w.code === "unsupported-graphql-type",
		);
		assert.ok(
			unsupported.length > 0,
			"expected at least one unsupported-graphql-type warning",
		);
		// Should flag the union type by name.
		assert.ok(
			unsupported.some((w) => w.message.includes("Node")),
			"expected union type Node to be flagged",
		);
		// Should flag the dangling reference to UndefinedType.
		assert.ok(
			unsupported.some((w) => w.message.includes("UndefinedType")),
			"expected dangling ref UndefinedType to be flagged",
		);
	});
});

describe("parse OpenAPI $ref parameters", () => {
	it("resolves operation-level $ref parameters into distinct entries", () => {
		const ir = parse(OPENAPI_REF_PARAMS);
		const tool = mustFindTool(ir, "listThings");

		// All three GitHub-style pagination refs must surface as distinct params,
		// not collapse into a single empty-name slot (the v0.5.0 regression).
		assert.equal(tool.parameters.length, 3);

		const names = tool.parameters.map((p) => p.name).sort();
		assert.deepEqual(names, [
			"direction",
			"pagination-after",
			"pagination-before",
		]);

		for (const param of tool.parameters) {
			assert.notEqual(param.name, "", "parameter name must not be empty");
			assert.notEqual(
				param.schema.kind,
				"unknown",
				`schema for "${param.name}" should be resolved, not unknown`,
			);
			assert.equal(param.in, "query");
		}

		const direction = mustFindParameter(tool, "direction");
		assert.equal(direction.schema.kind, "enum");
		if (direction.schema.kind === "enum") {
			assert.deepEqual(direction.schema.values, ["asc", "desc"]);
		}
	});

	it("drops unresolvable parameter $refs and surfaces a warning", () => {
		const ir = parse(OPENAPI_REF_PARAMS_BROKEN);
		const tool = mustFindTool(ir, "listThings");

		// Only the resolvable ref should make it through; the dangling ref is
		// dropped (no silent empty-name parameter).
		assert.equal(tool.parameters.length, 1);
		assert.equal(tool.parameters[0].name, "known");

		const warnings = validateIR(ir);
		const unresolved = warnings.filter((w) => w.code === "unresolved-ref");
		assert.ok(
			unresolved.some((w) => w.message.includes("DoesNotExist")),
			"expected unresolved-ref warning citing DoesNotExist",
		);
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

	it("resolves Swagger 2.0 $ref parameters via #/parameters/<name>", () => {
		const fixture = resolve(
			PROJECT_ROOT,
			"test",
			"fixtures",
			"swagger",
			"ref-params.json",
		);
		const ir = parse(fixture);
		const tool = mustFindTool(ir, "listThings");

		// Both reusable parameters should resolve into distinct, named entries.
		assert.equal(tool.parameters.length, 2);
		const names = tool.parameters.map((p) => p.name).sort();
		assert.deepEqual(names, ["limit", "offset"]);

		for (const param of tool.parameters) {
			assert.notEqual(param.name, "");
			assert.notEqual(param.schema.kind, "unknown");
		}
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

describe("parse HAR", () => {
	it("detects HAR from .har extension", () => {
		assert.equal(
			detectFormat('{"log":{"version":"1.2","entries":[]}}', HAR_SAMPLE),
			"har",
		);
	});

	it("detects HAR from content sniffing without extension", () => {
		const content = JSON.stringify({
			log: { version: "1.2", entries: [] },
		});
		assert.equal(detectFormat(content), "har");
	});

	it("collapses /users/{id} entries via path-template inference", () => {
		const ir = parse(HAR_SAMPLE);
		const paths = ir.tools.map((tool) => `${tool.method} ${tool.path}`);
		// /users/123 and /users/456 collapse into one GET /users/{id}
		assert.ok(paths.includes("GET /users/{id}"));
		assert.ok(paths.includes("GET /users"));
		assert.ok(paths.includes("POST /users"));
		assert.ok(paths.includes("DELETE /users/{id}"));
	});

	it("extracts query params from a GET entry", () => {
		const ir = parse(HAR_SAMPLE);
		const listUsers = ir.tools.find(
			(tool) => tool.method === "GET" && tool.path === "/users",
		);
		assert.ok(listUsers);
		const limit = listUsers.parameters.find((param) => param.name === "limit");
		assert.ok(limit);
		assert.equal(limit.in, "query");
		assert.equal(limit.schema.kind, "integer");
	});

	it("detects bearer auth from Authorization headers", () => {
		const ir = parse(HAR_SAMPLE);
		assert.ok(ir.auth.some((scheme) => scheme.scheme === "bearer"));
	});

	it("sets baseUrl to the common origin", () => {
		const ir = parse(HAR_SAMPLE);
		assert.equal(ir.meta.baseUrl, "https://api.example.com");
		assert.equal(ir.meta.sourceFormat, "har");
	});

	it("infers a JSON body schema for a POST entry", () => {
		const ir = parse(HAR_SAMPLE);
		const createUser = ir.tools.find(
			(tool) => tool.method === "POST" && tool.path === "/users",
		);
		assert.ok(createUser?.requestBody);
		assert.equal(createUser.requestBody.contentType, "application/json");
		assert.equal(createUser.requestBody.schema.kind, "object");
	});

	it("throws SpecParseError with format 'har' for malformed input", () => {
		const dir = mkdtempSync(resolve(tmpdir(), "ruah-conv-har-"));
		const bad = resolve(dir, "bad.har");
		writeFileSync(bad, '{"log":{"version":"1.2"}}', "utf8");
		assert.throws(
			() => parse(bad),
			(err: unknown) => {
				assert.ok(err instanceof SpecParseError);
				assert.equal(err.format, "har");
				return true;
			},
		);
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
