import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface ConvConfig {
	target?: string;
	output?: string;
	json?: boolean;
	name?: string;
	transport?: "stdio" | "streamable-http" | "sse" | "all";
}

const DEFAULT_CONFIG_FILES = [
	"ruah.conv.json",
	".ruah-conv.json",
	"ruah.conv.config.json",
];

export function loadConfig(
	specFile: string | undefined,
	explicitConfigPath: string | undefined,
): ConvConfig {
	const configPath =
		explicitConfigPath ??
		findNearestConfig(specFile ? dirname(resolve(specFile)) : process.cwd());
	if (!configPath) {
		return {};
	}

	const raw = readFileSync(configPath, "utf8");
	const parsed = JSON.parse(raw) as ConvConfig;
	return parsed ?? {};
}

function findNearestConfig(startDir: string): string | undefined {
	let current = resolve(startDir);

	while (true) {
		for (const fileName of DEFAULT_CONFIG_FILES) {
			const candidate = resolve(current, fileName);
			if (existsSync(candidate)) {
				return candidate;
			}
		}

		const parent = resolve(current, "..");
		if (parent === current) {
			return undefined;
		}
		current = parent;
	}
}
