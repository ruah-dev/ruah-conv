import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface PluginAuthorConfig {
	name?: string;
	url?: string;
	email?: string;
}

export interface PluginConfig {
	name?: string;
	description?: string;
	icon?: string;
	hiddenTools?: string[];
	author?: PluginAuthorConfig;
}

export interface PaginationOperationOverride {
	offsetParam?: string;
	limitParam?: string;
	pageParam?: string;
	pageSizeParam?: string;
	cursorParam?: string;
	style?: "offset-limit" | "page-number" | "cursor";
}

export interface PaginationDefaultsConfig {
	offsetParams?: string[];
	limitParams?: string[];
	pageParams?: string[];
	pageSizeParams?: string[];
	cursorParams?: string[];
}

export interface PaginationConfig {
	defaults?: PaginationDefaultsConfig;
	byOperation?: Record<string, PaginationOperationOverride>;
}

export interface ConvConfig {
	target?: string;
	output?: string;
	json?: boolean;
	name?: string;
	transport?: "stdio" | "streamable-http" | "sse" | "all";
	operationProfile?: "read-only" | "standard" | "all";
	plugin?: PluginConfig;
	pagination?: PaginationConfig;
	/**
	 * When `false`, scaffold targets skip the schema-driven auth wiring and
	 * emit a no-op `applyAuth` stub. Defaults to `true`. Equivalent to the
	 * CLI `--no-auth-wiring` flag.
	 */
	authWiring?: boolean;
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
