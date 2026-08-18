import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { applyCurate, proposeCurate } from "../src/curate/index.js";
import { truncateDescription } from "../src/curate/presets.js";
import {
	buildDeferredCatalog,
	buildDeferredToolDefinitions,
	DEFERRED_INVOKE,
	DEFERRED_SCHEMA,
	DEFERRED_SEARCH,
	searchCatalog,
} from "../src/generators/deferred.js";
import { generate } from "../src/generators/index.js";
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
const CLI = resolve(PROJECT_ROOT, "dist", "cli.js");

describe("searchCatalog", () => {
	const catalog = [
		{
			name: "listPets",
			description: "List all pets",
			method: "GET" as const,
			path: "/pets",
			risk: "safe" as const,
		},
		{
			name: "createOrder",
			description: "Create an order",
			method: "POST" as const,
			path: "/orders",
			risk: "moderate" as const,
		},
	];

	it("ranks exact name matches first", () => {
		const hits = searchCatalog(catalog, "listPets");
		assert.equal(hits[0]?.name, "listPets");
	});

	it("matches path fragments", () => {
		const hits = searchCatalog(catalog, "orders");
		assert.equal(hits.length, 1);
		assert.equal(hits[0]?.name, "createOrder");
	});

	it("returns the first page when the query is empty", () => {
		assert.equal(searchCatalog(catalog, "", 1).length, 1);
	});
});

describe("buildDeferredToolDefinitions", () => {
	it("exposes exactly three meta-tools", () => {
		const ir = parse(PETSTORE);
		const tools = buildDeferredToolDefinitions(ir);
		assert.deepEqual(
			tools.map((tool) => tool.name),
			[DEFERRED_SEARCH, DEFERRED_SCHEMA, DEFERRED_INVOKE],
		);
	});

	it("catalog lists every original operation", () => {
		const ir = parse(PETSTORE);
		const catalog = buildDeferredCatalog(ir);
		assert.equal(catalog.length, 4);
		assert.ok(catalog.some((entry) => entry.name === "listPets"));
	});
});

describe("generate --deferred", () => {
	it("mcp-tool-defs emits the three meta-tools", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-tool-defs", ir, { deferred: true });
		const tools = JSON.parse(result.files[0]?.content ?? "[]") as Array<{
			name: string;
		}>;
		assert.equal(tools.length, 3);
		assert.deepEqual(
			tools.map((tool) => tool.name),
			[DEFERRED_SEARCH, DEFERRED_SCHEMA, DEFERRED_INVOKE],
		);
		assert.equal(result.summary.toolCount, 3);
		assert.ok(result.summary.warnings[0]?.includes("4 operations"));
	});

	it("mcp-ts-server registers meta-tools, not listPets", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-ts-server", ir, { deferred: true });
		const generated = result.files.find(
			(file) => file.path === "src/generated.ts",
		);
		assert.ok(generated);
		assert.match(generated.content, /"search_tools"/);
		assert.match(generated.content, /TOOL_CATALOG/);
		assert.doesNotMatch(
			generated.content,
			/server\.registerTool\(\s*"listPets"/,
		);
		assert.equal(result.summary.toolCount, 3);
	});

	it("mcp-python-server registers meta-tools", () => {
		const ir = parse(PETSTORE);
		const result = generate("mcp-python-server", ir, { deferred: true });
		const server = result.files.find((file) => file.path === "server.py");
		assert.ok(server);
		assert.match(server.content, /name="search_tools"/);
		assert.match(server.content, /TOOL_CATALOG/);
		assert.doesNotMatch(server.content, /name="listPets"/);
	});
});

describe("description truncation", () => {
	it("adds an ellipsis at the budget", () => {
		assert.equal(truncateDescription("abcdefghij", 6), "abcde…");
	});

	it("minimal preset clips long merged descriptions", () => {
		const ir = parse(PETSTORE);
		const long = {
			...ir,
			tools: ir.tools.map((tool) => ({
				...tool,
				description: "x".repeat(200),
			})),
		};
		const curated = applyCurate(
			long,
			proposeCurate(long, { preset: "minimal", source: "petstore.yaml" }),
		);
		assert.ok(curated.tools.length >= 1);
		for (const tool of curated.tools) {
			assert.ok(tool.description.length <= 80);
			assert.ok(tool.description.endsWith("…"));
		}
	});
});

describe("deferred CLI", () => {
	it("rejects --deferred on openai-tools", () => {
		const cli = spawnSync(
			process.execPath,
			[CLI, "generate", PETSTORE, "--target", "openai-tools", "--deferred"],
			{ encoding: "utf8" },
		);
		assert.notEqual(cli.status, 0);
		assert.match(cli.stderr, /--deferred is not supported/);
	});

	it("emits three tools from generate --deferred --json", () => {
		const cli = spawnSync(
			process.execPath,
			[CLI, "generate", PETSTORE, "--deferred", "--json"],
			{ encoding: "utf8" },
		);
		assert.equal(cli.status, 0, cli.stderr);
		const tools = JSON.parse(cli.stdout) as Array<{ name: string }>;
		assert.deepEqual(
			tools.map((tool) => tool.name),
			[DEFERRED_SEARCH, DEFERRED_SCHEMA, DEFERRED_INVOKE],
		);
	});
});
