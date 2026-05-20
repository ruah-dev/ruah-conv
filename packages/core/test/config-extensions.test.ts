import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { PluginConfig } from "../src/config.js";
import { generate } from "../src/generators/index.js";
import type { RuahToolSchema } from "../src/ir/schema.js";
import { parse } from "../src/parsers/index.js";
import { parseOpenAPI } from "../src/parsers/openapi.js";
import { applyPaginationOverrides } from "../src/parsers/shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const PETSTORE = resolve(
	PROJECT_ROOT,
	"test",
	"fixtures",
	"clean",
	"petstore.yaml",
);

function readManifest(
	files: Array<{ path: string; content: string }>,
	path: string,
): Record<string, unknown> {
	const file = files.find((f) => f.path === path);
	assert.ok(file, `expected manifest at ${path}`);
	return JSON.parse(file.content) as Record<string, unknown>;
}

describe("plugin manifest config — claude-code", () => {
	it("emits the default manifest when no plugin config is provided", () => {
		const ir = parse(PETSTORE);
		const result = generate("claude-code-plugin-ts", ir, {
			name: "Petstore Plugin",
		});
		const manifest = readManifest(result.files, ".claude-plugin/plugin.json");
		assert.equal(manifest.name, "petstore-plugin");
		assert.equal((manifest.author as { name: string }).name, "ruah-conv");
		assert.equal(manifest.icon, undefined);
	});

	it("overrides plugin name and description via plugin config", () => {
		const ir = parse(PETSTORE);
		const plugin: PluginConfig = {
			name: "Billing Plugin",
			description: "Custom billing automation.",
		};
		const result = generate("claude-code-plugin-ts", ir, {
			name: "Petstore Plugin",
			plugin,
		});
		const manifest = readManifest(result.files, ".claude-plugin/plugin.json");
		assert.equal(manifest.name, "billing-plugin");
		assert.equal(manifest.description, "Custom billing automation.");
	});

	it("filters hidden tools from the generated server scaffold", () => {
		const ir = parse(PETSTORE);
		const plugin: PluginConfig = { hiddenTools: ["deletePet"] };
		const result = generate("claude-code-plugin-ts", ir, {
			name: "Petstore Plugin",
			plugin,
		});
		const serverFile = result.files.find((file) =>
			file.path.endsWith("generated.ts"),
		);
		assert.ok(serverFile, "expected a generated server file");
		assert.ok(
			!serverFile.content.includes("deletePet"),
			"hidden tool must not appear in generated server",
		);
		// Confirm the unrelated tool still survived.
		assert.ok(
			serverFile.content.includes("listPets") ||
				serverFile.content.includes("getPet"),
		);
	});

	it("references an icon path in the manifest when provided", () => {
		const ir = parse(PETSTORE);
		const tmpDir = mkdtempSync(resolve(tmpdir(), "ruah-conv-icon-"));
		const iconPath = resolve(tmpDir, "icon.png");
		writeFileSync(iconPath, "fake-png-bytes");
		const plugin: PluginConfig = { icon: iconPath };
		const result = generate("claude-code-plugin-ts", ir, {
			name: "Petstore Plugin",
			plugin,
		});
		const manifest = readManifest(result.files, ".claude-plugin/plugin.json");
		assert.equal(manifest.icon, iconPath);
	});

	it("emits a warning when the icon path does not exist", () => {
		const ir = parse(PETSTORE);
		const plugin: PluginConfig = { icon: "./does-not-exist.png" };
		const result = generate("claude-code-plugin-ts", ir, {
			name: "Petstore Plugin",
			plugin,
		});
		const manifest = readManifest(result.files, ".claude-plugin/plugin.json");
		assert.equal(manifest.icon, "./does-not-exist.png");
		assert.ok(
			result.summary.warnings.some((w) => w.includes("does-not-exist.png")),
			"expected missing-icon warning",
		);
	});

	it("honors plugin author overrides", () => {
		const ir = parse(PETSTORE);
		const plugin: PluginConfig = {
			author: { name: "Acme Co", url: "https://acme.example" },
		};
		const result = generate("claude-code-plugin-ts", ir, {
			name: "Petstore Plugin",
			plugin,
		});
		const manifest = readManifest(result.files, ".claude-plugin/plugin.json");
		assert.deepEqual(manifest.author, {
			name: "Acme Co",
			url: "https://acme.example",
		});
	});
});

describe("plugin manifest config — codex", () => {
	it("emits the default Codex manifest when no plugin config is provided", () => {
		const ir = parse(PETSTORE);
		const result = generate("codex-plugin-ts", ir, {
			name: "Petstore Plugin",
		});
		const manifest = readManifest(result.files, ".codex-plugin/plugin.json");
		assert.equal(manifest.name, "petstore-plugin");
		assert.equal((manifest.author as { name: string }).name, "ruah-conv");
	});

	it("overrides Codex plugin name and description via plugin config", () => {
		const ir = parse(PETSTORE);
		const plugin: PluginConfig = {
			name: "Billing Plugin",
			description: "Custom billing automation.",
		};
		const result = generate("codex-plugin-ts", ir, {
			name: "Petstore Plugin",
			plugin,
		});
		const manifest = readManifest(result.files, ".codex-plugin/plugin.json");
		assert.equal(manifest.name, "billing-plugin");
		assert.equal(manifest.description, "Custom billing automation.");
		const iface = manifest.interface as Record<string, unknown>;
		assert.equal(iface.displayName, "Billing Plugin");
	});

	it("filters hidden tools from the Codex plugin server scaffold", () => {
		const ir = parse(PETSTORE);
		const plugin: PluginConfig = { hiddenTools: ["deletePet"] };
		const result = generate("codex-plugin-ts", ir, {
			name: "Petstore Plugin",
			plugin,
		});
		const serverFile = result.files.find((file) =>
			file.path.endsWith("generated.ts"),
		);
		assert.ok(serverFile);
		assert.ok(!serverFile.content.includes("deletePet"));
	});

	it("references the icon in the Codex manifest when provided", () => {
		const ir = parse(PETSTORE);
		const tmpDir = mkdtempSync(resolve(tmpdir(), "ruah-conv-icon-codex-"));
		const iconPath = resolve(tmpDir, "icon.png");
		writeFileSync(iconPath, "x");
		const plugin: PluginConfig = { icon: iconPath };
		const result = generate("codex-plugin-ts", ir, {
			name: "Petstore Plugin",
			plugin,
		});
		const manifest = readManifest(result.files, ".codex-plugin/plugin.json");
		assert.equal(manifest.icon, iconPath);
	});
});

// ── Pagination overrides ───────────────────────────────────────────────

function syntheticOpenAPI(operations: {
	[opId: string]: {
		method: "get" | "post";
		path: string;
		params: Array<{ name: string; in: "query" | "path" }>;
	};
}): RuahToolSchema {
	const paths: Record<string, Record<string, unknown>> = {};
	for (const [opId, op] of Object.entries(operations)) {
		paths[op.path] = paths[op.path] ?? {};
		paths[op.path][op.method] = {
			operationId: opId,
			summary: opId,
			parameters: op.params.map((p) => ({
				name: p.name,
				in: p.in,
				required: p.in === "path",
				schema: { type: "string" },
			})),
			responses: {
				"200": { description: "ok" },
			},
		};
	}
	return parseOpenAPI("synthetic.yaml", {
		openapi: "3.0.3",
		info: { title: "Synthetic", version: "1.0.0" },
		paths,
	});
}

describe("applyPaginationOverrides", () => {
	it("returns the spec unchanged when no config is provided", () => {
		const ir = parse(PETSTORE);
		const result = applyPaginationOverrides(ir, undefined);
		assert.equal(result, ir);
	});

	it("preserves the existing offset/limit heuristic for the petstore fixture", () => {
		const ir = parse(PETSTORE);
		const listPets = ir.tools.find((tool) => tool.name === "listPets");
		assert.ok(listPets);
		assert.deepEqual(listPets.pagination, {
			style: "offset-limit",
			params: ["limit", "offset"],
		});
	});

	it("extends pagination detection via defaults.limitParams", () => {
		const ir = syntheticOpenAPI({
			listUsers: {
				method: "get",
				path: "/users",
				params: [
					{ name: "skip", in: "query" },
					{ name: "top", in: "query" },
				],
			},
		});
		// Without overrides, the heuristic should miss "skip" + "top".
		const before = ir.tools.find((tool) => tool.name === "listUsers");
		assert.ok(before);
		assert.equal(before.pagination, undefined);

		const overridden = applyPaginationOverrides(ir, {
			defaults: {
				offsetParams: ["skip"],
				limitParams: ["top"],
			},
		});
		const after = overridden.tools.find((tool) => tool.name === "listUsers");
		assert.ok(after);
		assert.equal(after.pagination?.style, "offset-limit");
		assert.ok(after.pagination?.params.includes("top"));
		assert.ok(after.pagination?.params.includes("skip"));
	});

	it("recognises cursor-style pagination via defaults.cursorParams", () => {
		const ir = syntheticOpenAPI({
			searchPosts: {
				method: "get",
				path: "/posts",
				params: [{ name: "next_token", in: "query" }],
			},
		});
		const overridden = applyPaginationOverrides(ir, {
			defaults: { cursorParams: ["next_token"] },
		});
		const after = overridden.tools.find((tool) => tool.name === "searchPosts");
		assert.ok(after);
		assert.equal(after?.pagination?.style, "cursor");
		assert.deepEqual(after?.pagination?.params, ["next_token"]);
	});

	it("overrides heuristic per operation via byOperation", () => {
		const ir = syntheticOpenAPI({
			listPets: {
				method: "get",
				path: "/pets",
				params: [
					{ name: "limit", in: "query" },
					{ name: "offset", in: "query" },
					{ name: "after", in: "query" },
				],
			},
		});
		// Default heuristic finds offset-limit.
		const before = ir.tools.find((tool) => tool.name === "listPets");
		assert.deepEqual(before?.pagination, {
			style: "offset-limit",
			params: ["limit", "offset"],
		});

		const overridden = applyPaginationOverrides(ir, {
			byOperation: {
				listPets: { cursorParam: "after" },
			},
		});
		const after = overridden.tools.find((tool) => tool.name === "listPets");
		assert.equal(after?.pagination?.style, "cursor");
		assert.deepEqual(after?.pagination?.params, ["after"]);
	});

	it("leaves tools untouched when their name is not in byOperation", () => {
		const ir = syntheticOpenAPI({
			listPets: {
				method: "get",
				path: "/pets",
				params: [
					{ name: "limit", in: "query" },
					{ name: "offset", in: "query" },
				],
			},
			createPet: {
				method: "post",
				path: "/pets",
				params: [],
			},
		});
		const overridden = applyPaginationOverrides(ir, {
			byOperation: {
				createPet: { cursorParam: "nope" },
			},
		});
		const list = overridden.tools.find((t) => t.name === "listPets");
		assert.deepEqual(list?.pagination, {
			style: "offset-limit",
			params: ["limit", "offset"],
		});
	});
});
