import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { RuahToolSchema } from "../src/ir/schema.js";
import { validateIR } from "../src/ir/validate.js";
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

describe("validateIR", () => {
	it("produces no errors for clean petstore spec", () => {
		const ir = parse(PETSTORE);
		const warnings = validateIR(ir);
		// The petstore fixture is well-formed; some params may lack descriptions
		// but there should be no critical warnings like no-operations
		const critical = warnings.filter((w) => w.code === "no-operations");
		assert.equal(critical.length, 0);
	});

	it("warns on missing tool description", () => {
		const ir: RuahToolSchema = {
			meta: {
				title: "Test",
				version: "1.0",
				sourceFormat: "openapi-3.0",
				sourceFile: "test.yaml",
				generatedAt: new Date().toISOString(),
				baseUrl: "http://localhost",
			},
			auth: [],
			tools: [
				{
					name: "testTool",
					description: "",
					method: "GET",
					path: "/test",
					parameters: [],
					responses: [],
					idempotent: true,
					readOnly: true,
					riskLevel: "safe",
				},
			],
			types: {},
		};

		const warnings = validateIR(ir);
		const descWarnings = warnings.filter(
			(w) => w.code === "missing-description",
		);
		assert.ok(descWarnings.length > 0);
	});

	it("warns on missing base URL", () => {
		const ir: RuahToolSchema = {
			meta: {
				title: "Test",
				version: "1.0",
				sourceFormat: "openapi-3.0",
				sourceFile: "test.yaml",
				generatedAt: new Date().toISOString(),
			},
			auth: [],
			tools: [
				{
					name: "testTool",
					description: "A test tool",
					method: "GET",
					path: "/test",
					parameters: [],
					responses: [],
					idempotent: true,
					readOnly: true,
					riskLevel: "safe",
				},
			],
			types: {},
		};

		const warnings = validateIR(ir);
		const urlWarnings = warnings.filter((w) => w.code === "missing-base-url");
		assert.equal(urlWarnings.length, 1);
	});

	it("warns on no operations", () => {
		const ir: RuahToolSchema = {
			meta: {
				title: "Test",
				version: "1.0",
				sourceFormat: "openapi-3.0",
				sourceFile: "test.yaml",
				generatedAt: new Date().toISOString(),
				baseUrl: "http://localhost",
			},
			auth: [],
			tools: [],
			types: {},
		};

		const warnings = validateIR(ir);
		const noOps = warnings.filter((w) => w.code === "no-operations");
		assert.equal(noOps.length, 1);
	});

	it("warns on duplicate tool names", () => {
		const tool = {
			name: "sameName",
			description: "Tool",
			method: "GET" as const,
			path: "/test",
			parameters: [],
			responses: [],
			idempotent: true,
			readOnly: true,
			riskLevel: "safe" as const,
		};

		const ir: RuahToolSchema = {
			meta: {
				title: "Test",
				version: "1.0",
				sourceFormat: "openapi-3.0",
				sourceFile: "test.yaml",
				generatedAt: new Date().toISOString(),
				baseUrl: "http://localhost",
			},
			auth: [],
			tools: [tool, { ...tool }],
			types: {},
		};

		const warnings = validateIR(ir);
		const dupeWarnings = warnings.filter(
			(w) => w.code === "duplicate-tool-name",
		);
		assert.ok(dupeWarnings.length > 0);
	});

	it("warns on unresolved type refs", () => {
		const ir: RuahToolSchema = {
			meta: {
				title: "Test",
				version: "1.0",
				sourceFormat: "openapi-3.0",
				sourceFile: "test.yaml",
				generatedAt: new Date().toISOString(),
				baseUrl: "http://localhost",
			},
			auth: [],
			tools: [
				{
					name: "testTool",
					description: "Test",
					method: "GET",
					path: "/test",
					parameters: [
						{
							name: "id",
							in: "query",
							required: false,
							description: "An ID",
							schema: { kind: "ref", $ref: "NonExistent" },
						},
					],
					responses: [],
					idempotent: true,
					readOnly: true,
					riskLevel: "safe",
				},
			],
			types: {},
		};

		const warnings = validateIR(ir);
		const refWarnings = warnings.filter((w) => w.code === "unresolved-ref");
		assert.equal(refWarnings.length, 1);
	});

	it("warns on unknown type kind", () => {
		const ir: RuahToolSchema = {
			meta: {
				title: "Test",
				version: "1.0",
				sourceFormat: "openapi-3.0",
				sourceFile: "test.yaml",
				generatedAt: new Date().toISOString(),
				baseUrl: "http://localhost",
			},
			auth: [],
			tools: [
				{
					name: "testTool",
					description: "Test",
					method: "GET",
					path: "/test",
					parameters: [
						{
							name: "data",
							in: "query",
							required: false,
							description: "Some data",
							schema: { kind: "unknown" },
						},
					],
					responses: [],
					idempotent: true,
					readOnly: true,
					riskLevel: "safe",
				},
			],
			types: {},
		};

		const warnings = validateIR(ir);
		const unknownWarnings = warnings.filter((w) => w.code === "unknown-type");
		assert.equal(unknownWarnings.length, 1);
	});
});
