import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	deduplicateNames,
	normalizeToolName,
	synthesizeToolName,
} from "../src/naming/index.js";

describe("normalizeToolName", () => {
	it("converts hyphenated names to camelCase", () => {
		assert.equal(normalizeToolName("list-pets"), "listPets");
	});

	it("converts underscored names to camelCase", () => {
		assert.equal(normalizeToolName("get_user_by_id"), "getUserById");
	});

	it("lowercases first character of PascalCase", () => {
		assert.equal(normalizeToolName("ListPets"), "listPets");
	});

	it("strips api prefix", () => {
		assert.equal(normalizeToolName("api_get_users"), "getUsers");
	});

	it("strips version prefix", () => {
		assert.equal(normalizeToolName("v2_get_users"), "getUsers");
	});

	it("handles dot-separated names", () => {
		assert.equal(normalizeToolName("pets.list"), "petsList");
	});

	it("returns fallback for empty string", () => {
		assert.equal(normalizeToolName("---"), "unknownTool");
	});
});

describe("synthesizeToolName", () => {
	it("creates name from GET /pets", () => {
		const name = synthesizeToolName("GET", "/pets");
		assert.equal(name, "getPets");
	});

	it("creates name from POST /pets", () => {
		const name = synthesizeToolName("POST", "/pets");
		assert.equal(name, "postPets");
	});

	it("handles path parameters", () => {
		const name = synthesizeToolName("GET", "/pets/{petId}");
		assert.equal(name, "getPetsPetId");
	});

	it("handles nested paths", () => {
		const name = synthesizeToolName("GET", "/users/{userId}/orders");
		assert.equal(name, "getUsersUserIdOrders");
	});
});

describe("deduplicateNames", () => {
	it("returns unchanged names when no duplicates", () => {
		const result = deduplicateNames(["listPets", "createPet", "getPet"]);
		assert.deepEqual(result, ["listPets", "createPet", "getPet"]);
	});

	it("appends numeric suffix for duplicates", () => {
		const result = deduplicateNames(["listPets", "listPets", "listPets"]);
		assert.deepEqual(result, ["listPets", "listPets2", "listPets3"]);
	});

	it("handles mixed duplicates and unique names", () => {
		const result = deduplicateNames(["getPet", "listPets", "getPet"]);
		assert.deepEqual(result, ["getPet", "listPets", "getPet2"]);
	});
});
