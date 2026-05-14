import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyOperationProfile,
	countExcludedToolsByOperationProfile,
	filterToolsByOperationProfile,
} from "../src/generators/operation-profile.js";
import type { RuahToolSchema, Tool } from "../src/ir/schema.js";

describe("operation profiles", () => {
	const spec = buildSpec([
		makeTool("listPets", "GET"),
		makeTool("getHealth", "HEAD"),
		makeTool("describeOptions", "OPTIONS"),
		makeTool("createPet", "POST"),
		makeTool("replacePet", "PUT"),
		makeTool("updatePet", "PATCH"),
		makeTool("deletePet", "DELETE"),
	]);

	it("read-only includes only safe methods", () => {
		const tools = filterToolsByOperationProfile(spec.tools, "read-only");
		assert.deepEqual(
			tools.map((tool) => tool.method),
			["GET", "HEAD", "OPTIONS"],
		);
	});

	it("standard excludes PATCH and DELETE", () => {
		const tools = filterToolsByOperationProfile(spec.tools, "standard");
		assert.deepEqual(
			tools.map((tool) => tool.method),
			["GET", "HEAD", "OPTIONS", "POST", "PUT"],
		);
		assert.equal(
			countExcludedToolsByOperationProfile(spec.tools, "standard"),
			2,
		);
	});

	it("all includes every method", () => {
		const tools = filterToolsByOperationProfile(spec.tools, "all");
		assert.equal(tools.length, spec.tools.length);
	});

	it("applyOperationProfile preserves metadata, auth, and types", () => {
		const filtered = applyOperationProfile(spec, "standard");
		assert.equal(filtered.meta, spec.meta);
		assert.equal(filtered.auth, spec.auth);
		assert.equal(filtered.types, spec.types);
		assert.notEqual(filtered.tools, spec.tools);
		assert.deepEqual(
			filtered.tools.map((tool) => tool.name),
			["listPets", "getHealth", "describeOptions", "createPet", "replacePet"],
		);
	});
});

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
