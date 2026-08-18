import type { HttpMethod } from "../ir/schema.js";
import type { CuratePreset } from "./types.js";

export interface PresetPolicy {
	id: CuratePreset;
	maxGroups: number;
	maxDepth: number;
	includeDeprecated: boolean;
	methods: ReadonlySet<HttpMethod> | null;
}

const ALL_METHODS: ReadonlySet<HttpMethod> = new Set([
	"GET",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
	"HEAD",
	"OPTIONS",
]);

const READ_METHODS: ReadonlySet<HttpMethod> = new Set([
	"GET",
	"HEAD",
	"OPTIONS",
]);

const PRESETS: Record<CuratePreset, PresetPolicy> = {
	minimal: {
		id: "minimal",
		maxGroups: 5,
		maxDepth: 1,
		includeDeprecated: false,
		methods: READ_METHODS,
	},
	standard: {
		id: "standard",
		maxGroups: 10,
		maxDepth: 2,
		includeDeprecated: false,
		methods: ALL_METHODS,
	},
	full: {
		id: "full",
		maxGroups: Number.POSITIVE_INFINITY,
		maxDepth: Number.POSITIVE_INFINITY,
		includeDeprecated: false,
		methods: ALL_METHODS,
	},
};

export function isCuratePreset(value: string): value is CuratePreset {
	return value === "minimal" || value === "standard" || value === "full";
}

export function parseCuratePreset(
	value: string | undefined,
	source: string,
): CuratePreset | undefined {
	if (value === undefined) return undefined;
	if (isCuratePreset(value)) return value;
	throw new Error(
		`Invalid ${source}: "${value}". Expected minimal, standard, or full.`,
	);
}

export function getPresetPolicy(preset: CuratePreset): PresetPolicy {
	return PRESETS[preset];
}
