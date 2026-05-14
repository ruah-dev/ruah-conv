import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveOperationProfile } from "../src/commands/generate-profile.js";

describe("resolveOperationProfile", () => {
	it("prompts for interactive OpenAPI runs without an explicit profile", () => {
		const result = resolveOperationProfile({
			sourceFormat: "openapi-3.0",
			jsonMode: false,
			stdinIsTTY: true,
			stdoutIsTTY: true,
			ci: false,
		});

		assert.deepEqual(result, {
			kind: "prompt",
			defaultProfile: "standard",
		});
	});

	it("defaults to standard for JSON-mode OpenAPI runs", () => {
		const result = resolveOperationProfile({
			sourceFormat: "openapi-3.0",
			jsonMode: true,
			stdinIsTTY: true,
			stdoutIsTTY: true,
			ci: false,
		});

		assert.deepEqual(result, {
			kind: "resolved",
			profile: "standard",
			source: "default",
		});
	});

	it("defaults to standard for non-interactive OpenAPI runs", () => {
		const result = resolveOperationProfile({
			sourceFormat: "swagger-2.0",
			jsonMode: false,
			stdinIsTTY: false,
			stdoutIsTTY: false,
			ci: false,
		});

		assert.deepEqual(result, {
			kind: "resolved",
			profile: "standard",
			source: "default",
		});
	});

	it("does nothing for Postman and GraphQL when no profile is set", () => {
		assert.deepEqual(
			resolveOperationProfile({
				sourceFormat: "postman-v2.1",
				jsonMode: false,
				stdinIsTTY: true,
				stdoutIsTTY: true,
				ci: false,
			}),
			{ kind: "none" },
		);

		assert.deepEqual(
			resolveOperationProfile({
				sourceFormat: "graphql-sdl",
				jsonMode: false,
				stdinIsTTY: true,
				stdoutIsTTY: true,
				ci: false,
			}),
			{ kind: "none" },
		);
	});

	it("respects an explicit profile without prompting", () => {
		const result = resolveOperationProfile({
			sourceFormat: "openapi-3.1",
			jsonMode: false,
			stdinIsTTY: true,
			stdoutIsTTY: true,
			ci: false,
			explicitProfile: "all",
		});

		assert.deepEqual(result, {
			kind: "resolved",
			profile: "all",
			source: "flag",
		});
	});

	it("lets the CLI flag override config", () => {
		const result = resolveOperationProfile({
			sourceFormat: "openapi-3.0",
			jsonMode: false,
			stdinIsTTY: true,
			stdoutIsTTY: true,
			ci: false,
			explicitProfile: "all",
			configProfile: "read-only",
		});

		assert.deepEqual(result, {
			kind: "resolved",
			profile: "all",
			source: "flag",
		});
	});
});
