import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PACKAGE_NAME = "@ruah-dev/conv";

export function getGlobalBinDir(env = process.env, platform = process.platform) {
	const prefix = env.npm_config_prefix;
	if (!prefix) {
		return null;
	}
	return platform === "win32" ? prefix : join(prefix, "bin");
}

export function resolveCliEntrypoint(npmConfigPrefix, platform) {
	const binDir = !npmConfigPrefix
		? ""
		: platform === "win32"
			? npmConfigPrefix
			: `${npmConfigPrefix}/bin`.replace(/\/+/g, "/");

	let entrypoint = "";
	if (npmConfigPrefix) {
		const libNodeModules =
			platform === "win32"
				? `${npmConfigPrefix}\\node_modules\\@ruah-dev\\cli\\dist\\cli.js`
				: `${npmConfigPrefix}/lib/node_modules/@ruah-dev/cli/dist/cli.js`;
		entrypoint = libNodeModules;
	}

	return { entrypoint, binDir };
}

export function chooseLauncherPath(binDir, platform) {
	if (platform === "win32") {
		return `${binDir}\\ruah.cmd`;
	}
	return `${binDir}/ruah`;
}

export function buildUnixLauncher(cliPath) {
	const escapedPath = cliPath.replace(/'/g, `'\"'\"'`);
	return `#!/usr/bin/env sh\nexec node '${escapedPath}' \"$@\"\n`;
}

export function buildUnixLauncherScript(entrypoint) {
	return buildUnixLauncher(entrypoint);
}

export function buildWindowsLauncherScript(entrypoint) {
	const escaped = entrypoint.replace(/"/g, '""');
	return `@ECHO OFF\r\nnode "${escaped}" %*\r\n`;
}

function resolveCliFromRequire() {
	try {
		const packageJsonPath = require.resolve("@ruah-dev/cli/package.json");
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
		const bin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.ruah;
		return resolve(dirname(packageJsonPath), bin ?? "dist/cli.js");
	} catch {
		return null;
	}
}

function installGlobalLauncher() {
	if (
		process.env.npm_config_global !== "true" &&
		process.env.npm_config_location !== "global"
	) {
		return;
	}

	const cliPath = resolveCliFromRequire();
	if (!cliPath) {
		console.warn(
			`[${PACKAGE_NAME}] Installed without @ruah-dev/cli. Use \`ruah-conv\` directly, or install @ruah-dev/cli for the top-level \`ruah conv\` command.`,
		);
		return;
	}

	const binDir = getGlobalBinDir();
	if (!binDir) {
		console.warn(
			`[${PACKAGE_NAME}] Installed @ruah-dev/cli but could not determine the global bin directory. Use \`ruah-conv\` directly, or reinstall @ruah-dev/cli if \`ruah\` is missing.`,
		);
		return;
	}

	const launcherPath = chooseLauncherPath(binDir, process.platform);
	if (existsSync(launcherPath)) {
		return;
	}

	try {
		mkdirSync(binDir, { recursive: true });

		if (process.platform === "win32") {
			writeFileSync(launcherPath, buildWindowsLauncherScript(cliPath), "utf8");
			return;
		}

		writeFileSync(launcherPath, buildUnixLauncherScript(cliPath), "utf8");
		chmodSync(launcherPath, 0o755);
	} catch (err) {
		console.warn(
			`[${PACKAGE_NAME}] Failed to write launcher at ${launcherPath}: ${err?.message ?? err}`,
		);
	}
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	installGlobalLauncher();
}
