// Integration smoke test for the generated mcp-ts-server scaffold.
//
// What it does:
//   1. Runs the `mcp-ts-server` generator against the petstore fixture
//   2. Writes the scaffold to a tmpdir
//   3. `npm install` + `npm run build` inside that tmpdir
//   4. Spawns `node dist/index.js` and speaks JSON-RPC (MCP) over stdio
//   5. Asserts `initialize` + `tools/list` round-trip with the expected tools
//   6. Optional `tools/call` smoke (no upstream HTTP server; expects a graceful
//      JSON-RPC response — error content is fine, a crash is not)
//
// Why it's gated:
//   `npm install` against the real registry is slow and network-dependent.
//   The default `npm test` glob (`dist-test/test/*.test.js`) does not descend
//   into `integration/`, so this file is opt-in via the `test:integration`
//   script, or by setting `RUN_INTEGRATION=1` and invoking node --test directly.
//
// To run locally:
//   cd packages/core && npm run test:integration

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { generate } from "../../src/generators/index.js";
import { parse } from "../../src/parsers/index.js";

const SHOULD_RUN = process.env.RUN_INTEGRATION === "1";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");
const PETSTORE = resolve(
	PROJECT_ROOT,
	"test",
	"fixtures",
	"clean",
	"petstore.yaml",
);

// Generous bounds — npm install dominates wall clock and is network-bound.
const NPM_INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const BUILD_TIMEOUT_MS = 60 * 1000;
const RPC_TIMEOUT_MS = 15 * 1000;

describe("mcp-ts-server integration smoke", { skip: !SHOULD_RUN }, () => {
	let workDir: string;
	let entrypoint: string;

	before(() => {
		workDir = mkdtempSync(resolve(tmpdir(), "ruah-conv-integration-"));
		const ir = parse(PETSTORE);
		const result = generate("mcp-ts-server", ir, {
			name: "Petstore Integration Server",
		});

		for (const file of result.files) {
			const target = resolve(workDir, file.path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, file.content, "utf8");
		}

		const install = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
			cwd: workDir,
			encoding: "utf8",
			timeout: NPM_INSTALL_TIMEOUT_MS,
		});
		assert.equal(
			install.status,
			0,
			`npm install failed:\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`,
		);

		const build = spawnSync("npm", ["run", "build"], {
			cwd: workDir,
			encoding: "utf8",
			timeout: BUILD_TIMEOUT_MS,
		});
		assert.equal(
			build.status,
			0,
			`npm run build failed:\nstdout:\n${build.stdout}\nstderr:\n${build.stderr}`,
		);

		entrypoint = resolve(workDir, "dist", "index.js");
	});

	after(() => {
		if (workDir) {
			rmSync(workDir, { recursive: true, force: true });
		}
	});

	it("answers initialize + tools/list over stdio", async () => {
		const session = await openSession(entrypoint);
		try {
			// 1. initialize
			const initResponse = await session.request({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "ruah-conv-integration", version: "0.0.0" },
				},
			});
			assert.equal(initResponse.id, 1);
			assert.ok(
				initResponse.result,
				`initialize response missing result: ${JSON.stringify(initResponse)}`,
			);

			// MCP requires an initialized notification before further requests.
			session.notify({
				jsonrpc: "2.0",
				method: "notifications/initialized",
			});

			// 2. tools/list
			const listResponse = await session.request({
				jsonrpc: "2.0",
				id: 2,
				method: "tools/list",
				params: {},
			});
			assert.equal(listResponse.id, 2);
			assert.ok(
				listResponse.result,
				`tools/list response missing result: ${JSON.stringify(listResponse)}`,
			);
			const tools = (listResponse.result as { tools: Array<{ name: string }> })
				.tools;
			assert.ok(Array.isArray(tools), "tools/list result must include tools[]");
			const names = tools.map((tool) => tool.name).sort();
			assert.deepEqual(
				names,
				["createPet", "deletePet", "getPet", "listPets"],
				`unexpected tool list: ${JSON.stringify(names)}`,
			);

			// 3. bonus: tools/call should not crash the server even when the
			// upstream HTTP host is unreachable (petstore.example.com is fake).
			// We accept either a JSON-RPC error or a result with isError=true.
			const callResponse = await session.request({
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: { name: "listPets", arguments: {} },
			});
			assert.equal(callResponse.id, 3);
			assert.ok(
				callResponse.error || callResponse.result,
				`tools/call must produce a well-formed JSON-RPC response: ${JSON.stringify(callResponse)}`,
			);
		} finally {
			await session.close();
		}
	});
});

type JsonRpcMessage = {
	jsonrpc: "2.0";
	id?: number | string;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
};

type Session = {
	request: (message: JsonRpcMessage) => Promise<JsonRpcMessage>;
	notify: (message: JsonRpcMessage) => void;
	close: () => Promise<void>;
};

async function openSession(entrypoint: string): Promise<Session> {
	const child = spawn(process.execPath, [entrypoint], {
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			// Intentionally do NOT set API_KEY / BEARER_TOKEN — the scaffold must
			// start up cleanly without auth env vars. If startup crashes here,
			// the auth-wiring contract has regressed.
		},
	});

	const stderrChunks: string[] = [];
	child.stderr.on("data", (chunk: Buffer) => {
		stderrChunks.push(chunk.toString("utf8"));
	});

	let exited = false;
	let exitCode: number | null = null;
	child.on("exit", (code) => {
		exited = true;
		exitCode = code;
	});

	const pending = new Map<
		number | string,
		{
			resolve: (value: JsonRpcMessage) => void;
			reject: (reason: Error) => void;
		}
	>();

	let buffer = "";
	child.stdout.on("data", (chunk: Buffer) => {
		buffer += chunk.toString("utf8");
		let newlineIndex = buffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = buffer.slice(0, newlineIndex).trim();
			buffer = buffer.slice(newlineIndex + 1);
			if (line.length > 0) {
				try {
					const message = JSON.parse(line) as JsonRpcMessage;
					if (message.id !== undefined && pending.has(message.id)) {
						const entry = pending.get(message.id);
						pending.delete(message.id);
						entry?.resolve(message);
					}
				} catch {
					// Ignore non-JSON noise on stdout.
				}
			}
			newlineIndex = buffer.indexOf("\n");
		}
	});

	const send = (message: JsonRpcMessage) => {
		child.stdin.write(`${JSON.stringify(message)}\n`);
	};

	return {
		request(message) {
			if (message.id === undefined) {
				throw new Error("JSON-RPC request requires an id");
			}
			const id = message.id;
			return new Promise<JsonRpcMessage>((resolvePromise, rejectPromise) => {
				const timer = setTimeout(() => {
					pending.delete(id);
					const reason =
						`Timed out after ${RPC_TIMEOUT_MS}ms waiting for response to ${message.method ?? "<unknown>"}.\n` +
						`Child exited: ${exited} (code=${exitCode}).\nstderr:\n${stderrChunks.join("")}`;
					rejectPromise(new Error(reason));
				}, RPC_TIMEOUT_MS);

				pending.set(id, {
					resolve: (value) => {
						clearTimeout(timer);
						resolvePromise(value);
					},
					reject: (reason) => {
						clearTimeout(timer);
						rejectPromise(reason);
					},
				});

				send(message);
			});
		},
		notify(message) {
			send(message);
		},
		async close() {
			if (!exited) {
				child.kill("SIGTERM");
				await new Promise<void>((resolveClose) => {
					const timer = setTimeout(() => {
						child.kill("SIGKILL");
						resolveClose();
					}, 2000);
					child.once("exit", () => {
						clearTimeout(timer);
						resolveClose();
					});
				});
			}
		},
	};
}
