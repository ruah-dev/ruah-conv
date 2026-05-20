import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildUnixLauncher,
	buildUnixLauncherScript,
	buildWindowsLauncherScript,
	chooseLauncherPath,
	getGlobalBinDir,
	resolveCliEntrypoint,
} from "../postinstall.mjs";

test("getGlobalBinDir resolves unix global bins", () => {
	assert.equal(
		getGlobalBinDir(
			{ npm_config_prefix: "/tmp/ruah", npm_config_global: "true" },
			"darwin",
		),
		"/tmp/ruah/bin",
	);
});

test("getGlobalBinDir returns null when prefix missing", () => {
	assert.equal(getGlobalBinDir({}, "linux"), null);
});

test("buildUnixLauncher delegates to node", () => {
	const launcher = buildUnixLauncher("/tmp/ruah cli/dist/cli.js");
	assert.match(launcher, /exec node '/);
	assert.match(launcher, /dist\/cli\.js/);
});

test("resolveCliEntrypoint: linux paths", () => {
	const { entrypoint, binDir } = resolveCliEntrypoint("/usr/local", "linux");
	assert.equal(binDir, "/usr/local/bin");
	assert.equal(
		entrypoint,
		"/usr/local/lib/node_modules/@ruah-dev/cli/dist/cli.js",
	);
});

test("resolveCliEntrypoint: macOS (darwin) paths", () => {
	const { entrypoint, binDir } = resolveCliEntrypoint(
		"/opt/homebrew",
		"darwin",
	);
	assert.equal(binDir, "/opt/homebrew/bin");
	assert.equal(
		entrypoint,
		"/opt/homebrew/lib/node_modules/@ruah-dev/cli/dist/cli.js",
	);
});

test("resolveCliEntrypoint: Windows paths", () => {
	const { entrypoint, binDir } = resolveCliEntrypoint(
		"C:\\Users\\foo\\AppData\\Roaming\\npm",
		"win32",
	);
	assert.equal(binDir, "C:\\Users\\foo\\AppData\\Roaming\\npm");
	assert.equal(
		entrypoint,
		"C:\\Users\\foo\\AppData\\Roaming\\npm\\node_modules\\@ruah-dev\\cli\\dist\\cli.js",
	);
});

test("resolveCliEntrypoint: empty prefix yields empty strings (caller skips install)", () => {
	const { entrypoint, binDir } = resolveCliEntrypoint("", "linux");
	assert.equal(entrypoint, "");
	assert.equal(binDir, "");
});

test("chooseLauncherPath: Unix → <binDir>/ruah", () => {
	assert.equal(
		chooseLauncherPath("/usr/local/bin", "linux"),
		"/usr/local/bin/ruah",
	);
	assert.equal(
		chooseLauncherPath("/opt/homebrew/bin", "darwin"),
		"/opt/homebrew/bin/ruah",
	);
});

test("chooseLauncherPath: Windows → <binDir>\\ruah.cmd", () => {
	assert.equal(
		chooseLauncherPath("C:\\Users\\foo\\AppData\\Roaming\\npm", "win32"),
		"C:\\Users\\foo\\AppData\\Roaming\\npm\\ruah.cmd",
	);
});

test("buildUnixLauncherScript: shebang, node, entrypoint", () => {
	const entrypoint = "/usr/local/lib/node_modules/@ruah-dev/cli/dist/cli.js";
	const script = buildUnixLauncherScript(entrypoint);
	assert.match(script, /^#!\/usr\/bin\/env sh/);
	assert.match(script, /\bnode\b/);
	assert.ok(script.includes(entrypoint), "must contain entrypoint path");
	assert.match(script, /"\$@"/);
});

test("buildUnixLauncherScript: quotes paths with spaces", () => {
	const entrypoint =
		"/home/some user/lib/node_modules/@ruah-dev/cli/dist/cli.js";
	const script = buildUnixLauncherScript(entrypoint);
	assert.ok(
		script.includes(`'${entrypoint}'`),
		"path with spaces must be single-quoted",
	);
});

test("buildWindowsLauncherScript: @ECHO OFF, node, entrypoint", () => {
	const entrypoint =
		"C:\\Users\\foo\\AppData\\Roaming\\npm\\node_modules\\@ruah-dev\\cli\\dist\\cli.js";
	const script = buildWindowsLauncherScript(entrypoint);
	assert.match(script, /@ECHO OFF/i);
	assert.match(script, /\bnode\b/);
	assert.ok(script.includes(entrypoint), "must contain entrypoint path");
	assert.match(script, /%\*/);
});

test("buildWindowsLauncherScript: quotes paths with spaces", () => {
	const entrypoint =
		"C:\\Program Files\\nodejs\\node_modules\\@ruah-dev\\cli\\dist\\cli.js";
	const script = buildWindowsLauncherScript(entrypoint);
	assert.ok(
		script.includes(`"${entrypoint}"`),
		"path with spaces must be double-quoted",
	);
});

test("buildWindowsLauncherScript: uses CRLF line endings", () => {
	const script = buildWindowsLauncherScript("C:\\x.js");
	assert.match(script, /\r\n/);
});
