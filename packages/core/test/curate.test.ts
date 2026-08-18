import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	actionFor,
	applyCurate,
	estimateTokens,
	familyFromPath,
	parseCurationPlan,
	proposeCurate,
	replayPlan,
	scoreTool,
} from "../src/curate/index.js";
import { generate } from "../src/generators/index.js";
import type { Tool } from "../src/ir/schema.js";
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
const CATALOG = resolve(
	PROJECT_ROOT,
	"test",
	"fixtures",
	"curate",
	"catalog.yaml",
);
const CLI = resolve(PROJECT_ROOT, "dist", "cli.js");

function stubTool(
	partial: Partial<Tool> & Pick<Tool, "method" | "path">,
): Tool {
	return {
		name: partial.name ?? "tool",
		description: partial.description ?? "",
		method: partial.method,
		path: partial.path,
		parameters: partial.parameters ?? [],
		responses: partial.responses ?? [],
		idempotent: partial.idempotent ?? true,
		readOnly: partial.readOnly ?? partial.method === "GET",
		riskLevel: partial.riskLevel ?? "safe",
		deprecated: partial.deprecated,
		tags: partial.tags,
		operationId: partial.operationId,
		requestBody: partial.requestBody,
	};
}

describe("familyFromPath", () => {
	it("groups collection and item under the same family", () => {
		assert.equal(familyFromPath("/users").id, "users");
		assert.equal(familyFromPath("/users/{userId}").id, "users");
	});

	it("keeps sub-resources in their own family", () => {
		assert.equal(familyFromPath("/users/{userId}/orders").id, "users/orders");
		assert.equal(
			familyFromPath("/users/{userId}/orders").basePath,
			"/users/orders",
		);
	});

	it("does not merge versioned paths", () => {
		assert.equal(familyFromPath("/v1/users").id, "v1/users");
		assert.equal(familyFromPath("/v2/users").id, "v2/users");
		assert.notEqual(
			familyFromPath("/v1/users").id,
			familyFromPath("/v2/users").id,
		);
	});
});

describe("actionFor", () => {
	it("maps CRUD verbs", () => {
		assert.equal(actionFor("GET", "/pets"), "list");
		assert.equal(actionFor("GET", "/pets/{id}"), "get");
		assert.equal(actionFor("POST", "/pets"), "create");
		assert.equal(actionFor("PATCH", "/pets/{id}"), "update");
		assert.equal(actionFor("PUT", "/pets/{id}"), "replace");
		assert.equal(actionFor("DELETE", "/pets/{id}"), "delete");
	});
});

describe("scoreTool", () => {
	it("ranks collection GET above DELETE", () => {
		const list = scoreTool(stubTool({ method: "GET", path: "/pets" }));
		const remove = scoreTool(
			stubTool({ method: "DELETE", path: "/pets/{id}" }),
		);
		assert.ok(list > remove);
	});

	it("floors deprecated operations", () => {
		assert.equal(
			scoreTool(stubTool({ method: "GET", path: "/legacy", deprecated: true })),
			0,
		);
	});
});

describe("proposeCurate", () => {
	it("collapses petstore CRUD into one task tool", () => {
		const ir = parse(PETSTORE);
		const plan = proposeCurate(ir, { source: "petstore.yaml" });
		assert.equal(plan.schemaVersion, "1");
		assert.equal(plan.totalTools, 4);
		assert.equal(plan.curatedTools, 1);
		assert.equal(plan.groups.length, 1);
		assert.equal(plan.groups[0]?.name, "managePets");
		assert.deepEqual(
			plan.groups[0]?.members.map((member) => member.action).sort(),
			["create", "delete", "get", "list"],
		);
		assert.ok(plan.curatedTokens < plan.definitionTokens);
	});

	it("does not merge /v1 and /v2 families", () => {
		const ir = parse(CATALOG);
		const plan = proposeCurate(ir, { preset: "full", source: "catalog.yaml" });
		const ids = plan.groups.map((group) => group.id);
		assert.ok(ids.includes("v1/users"));
		assert.ok(ids.includes("v2/users"));
	});

	it("drops deprecated endpoints with a reason", () => {
		const ir = parse(CATALOG);
		const plan = proposeCurate(ir, { preset: "full", source: "catalog.yaml" });
		const legacy = plan.dropped.find((item) => item.name === "getLegacy");
		assert.ok(legacy);
		assert.equal(legacy.reason, "deprecated");
	});

	it("caps standard preset at 10 task tools", () => {
		const ir = parse(CATALOG);
		const plan = proposeCurate(ir, {
			preset: "standard",
			source: "catalog.yaml",
		});
		assert.ok(plan.totalTools > 10);
		assert.ok(plan.curatedTools <= 10);
		assert.ok(plan.dropped.some((item) => item.reason === "over-budget"));
	});

	it("minimal preset keeps only read methods", () => {
		const ir = parse(CATALOG);
		const plan = proposeCurate(ir, {
			preset: "minimal",
			source: "catalog.yaml",
		});
		assert.ok(plan.curatedTools <= 5);
		assert.ok(
			plan.dropped.some((item) => item.reason === "preset-minimal-method"),
		);
	});

	it("caps a 100-endpoint spec at 10 task tools", () => {
		const dir = mkdtempSync(resolve(tmpdir(), "ruah-curate-large-"));
		const specPath = resolve(dir, "large.yaml");
		writeFileSync(specPath, syntheticOpenApi(20), "utf8");
		const ir = parse(specPath);
		assert.equal(ir.tools.length, 100);
		const plan = proposeCurate(ir, {
			preset: "standard",
			source: "large.yaml",
		});
		assert.ok(plan.curatedTools <= 10);
		assert.ok(plan.dropped.length > 0);
		const curated = applyCurate(ir, plan);
		assert.ok(curated.tools.length <= 10);
		const generated = generate("mcp-tool-defs", curated);
		assert.ok((generated.summary.toolCount ?? 0) <= 10);
		assert.equal(generated.summary.sourceToolCount, curated.tools.length);
		assert.ok((generated.summary.definitionTokens ?? 0) > 0);
	});

	it("is deterministic", () => {
		const ir = parse(CATALOG);
		const a = JSON.stringify(proposeCurate(ir, { source: "catalog.yaml" }));
		const b = JSON.stringify(proposeCurate(ir, { source: "catalog.yaml" }));
		assert.equal(a, b);
	});
});

describe("applyCurate", () => {
	it("emits a merged tool with an action enum", () => {
		const ir = parse(PETSTORE);
		const plan = proposeCurate(ir, { source: "petstore.yaml" });
		const curated = applyCurate(ir, plan);
		assert.equal(curated.tools.length, 1);
		const tool = curated.tools[0];
		assert.ok(tool);
		assert.equal(tool.name, "managePets");
		assert.equal(tool.requestBody?.schema.kind, "object");
		const schema = tool.requestBody?.schema;
		assert.ok(schema && schema.kind === "object");
		const action = schema.properties.action?.type;
		assert.ok(action && action.kind === "enum");
		assert.deepEqual([...action.values].sort(), [
			"create",
			"delete",
			"get",
			"list",
		]);
		assert.ok(schema.required.includes("action"));
	});

	it("split keeps original operations", () => {
		const ir = parse(PETSTORE);
		const plan = proposeCurate(ir, { source: "petstore.yaml" });
		const first = plan.groups[0];
		assert.ok(first);
		plan.groups[0] = {
			...first,
			decision: "split",
			reason: "test:split",
		};
		const curated = applyCurate(ir, plan);
		assert.equal(curated.tools.length, 4);
		assert.ok(curated.tools.some((tool) => tool.name === "listPets"));
	});
});

describe("replayPlan", () => {
	it("replays saved decisions and reports added/removed endpoints", () => {
		const ir = parse(CATALOG);
		const original = proposeCurate(ir, {
			preset: "full",
			source: "catalog.yaml",
		});
		const saved = structuredClone(original);
		const pets = saved.groups.find((group) => group.id === "pets");
		assert.ok(pets);
		pets.decision = "drop";
		pets.reason = "plan:drop";

		const mutatedTools = ir.tools.filter((tool) => tool.name !== "listStores");
		const mutated = {
			...ir,
			tools: [
				...mutatedTools,
				stubTool({
					name: "listTags",
					method: "GET",
					path: "/tags",
					tags: ["tags"],
				}),
			],
		};
		const proposed = proposeCurate(mutated, {
			preset: "full",
			source: "catalog.yaml",
		});
		const { plan, drift } = replayPlan(proposed, saved);

		const replayedPets = plan.groups.find((group) => group.id === "pets");
		assert.equal(replayedPets?.decision, "drop");
		assert.ok(drift.added.some((item) => item.path === "/tags"));
		assert.ok(drift.removed.some((item) => item.path === "/stores"));
	});

	it("rejects an unknown schemaVersion", () => {
		assert.throws(
			() => parseCurationPlan({ schemaVersion: "9", groups: [] }),
			/schemaVersion/,
		);
	});
});

describe("estimateTokens", () => {
	it("matches the hand-checked tiny fixture within tolerance", () => {
		const text = "list pets by status";
		const tokens = estimateTokens(text);
		// chars/4 = 4.75, words*1.32 = 5.28, blend ≈ 5
		assert.equal(tokens, 5);
	});
});

describe("generate consumes curated IR", () => {
	it("mcp-tool-defs emits the merged managePets schema", () => {
		const ir = parse(PETSTORE);
		const curated = applyCurate(
			ir,
			proposeCurate(ir, { source: "petstore.yaml" }),
		);
		const result = generate("mcp-tool-defs", curated);
		const tools = JSON.parse(result.files[0]?.content ?? "[]") as Array<{
			name: string;
			inputSchema: { properties?: Record<string, unknown> };
		}>;
		assert.equal(tools.length, 1);
		assert.equal(tools[0]?.name, "managePets");
		assert.ok(tools[0]?.inputSchema.properties?.action);
	});
});

describe("curate CLI", () => {
	it("--help leads with the one-line question", () => {
		const res = spawnSync(process.execPath, [CLI, "--help"], {
			encoding: "utf8",
		});
		assert.equal(res.status, 0, res.stderr);
		assert.match(res.stdout, /How do I make this API agent-sized\?/);
		assert.match(res.stdout, /curate is the headline/);
	});

	it("prints a versioned JSON plan", () => {
		const cli = spawnSync(
			process.execPath,
			[CLI, "curate", PETSTORE, "--json"],
			{
				encoding: "utf8",
			},
		);
		assert.equal(cli.status, 0, cli.stderr);
		const payload = JSON.parse(cli.stdout) as {
			schemaVersion: string;
			curatedTools: number;
			totalTools: number;
			groups: unknown[];
		};
		assert.equal(payload.schemaVersion, "1");
		assert.equal(payload.totalTools, 4);
		assert.equal(payload.curatedTools, 1);
		assert.ok(Array.isArray(payload.groups));
	});

	it("writes curation.json to --out and generate --plan replays it", () => {
		const dir = mkdtempSync(resolve(tmpdir(), "ruah-curate-"));
		const curate = spawnSync(
			process.execPath,
			[CLI, "curate", PETSTORE, "--out", dir, "--json"],
			{ encoding: "utf8" },
		);
		assert.equal(curate.status, 0, curate.stderr);
		const planPath = resolve(dir, "curation.json");
		const saved = JSON.parse(readFileSync(planPath, "utf8")) as {
			curatedTools: number;
		};
		assert.equal(saved.curatedTools, 1);

		const generated = spawnSync(
			process.execPath,
			[CLI, "generate", PETSTORE, "--plan", planPath, "--json"],
			{ encoding: "utf8" },
		);
		assert.equal(generated.status, 0, generated.stderr);
		const tools = JSON.parse(generated.stdout) as Array<{ name: string }>;
		assert.equal(tools.length, 1);
		assert.equal(tools[0]?.name, "managePets");
	});

	it("reports drift when the spec gains an endpoint", () => {
		const dir = mkdtempSync(resolve(tmpdir(), "ruah-curate-drift-"));
		const first = spawnSync(
			process.execPath,
			[CLI, "curate", PETSTORE, "--out", dir, "--json"],
			{ encoding: "utf8" },
		);
		assert.equal(first.status, 0, first.stderr);

		const mutated = `${readFileSync(PETSTORE, "utf8")}
  /tags:
    get:
      operationId: listTags
      responses:
        "200":
          description: ok
`;
		const mutatedPath = resolve(dir, "mutated.yaml");
		writeFileSync(mutatedPath, mutated, "utf8");
		const replay = spawnSync(
			process.execPath,
			[
				CLI,
				"curate",
				mutatedPath,
				"--plan",
				resolve(dir, "curation.json"),
				"--json",
			],
			{ encoding: "utf8" },
		);
		assert.equal(replay.status, 0, replay.stderr);
		const payload = JSON.parse(replay.stdout) as {
			drift: { added: Array<{ path: string }>; removed: unknown[] };
		};
		assert.ok(payload.drift.added.some((item) => item.path === "/tags"));
	});
});

/** 20 resources × 5 verbs = 100 operations. */
function syntheticOpenApi(resources: number): string {
	const paths: string[] = [];
	for (let i = 0; i < resources; i++) {
		const name = `res${String(i).padStart(2, "0")}`;
		paths.push(`  /${name}:
    get:
      operationId: list_${name}
      tags: [${name}]
      responses: { "200": { description: ok } }
    post:
      operationId: create_${name}
      tags: [${name}]
      responses: { "201": { description: created } }
  /${name}/{id}:
    get:
      operationId: get_${name}
      tags: [${name}]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses: { "200": { description: ok } }
    patch:
      operationId: update_${name}
      tags: [${name}]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses: { "200": { description: ok } }
    delete:
      operationId: delete_${name}
      tags: [${name}]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses: { "204": { description: gone } }`);
	}
	return `openapi: "3.0.3"
info:
  title: Large Catalog
  version: "1.0.0"
paths:
${paths.join("\n")}
`;
}
