import type {
	HttpMethod,
	RuahToolSchema,
	SourceFormat,
	Tool,
} from "../ir/schema.js";

export type OperationProfile = "read-only" | "standard" | "all";

export const DEFAULT_OPERATION_PROFILE: OperationProfile = "standard";

const OPERATION_PROFILE_METHODS: Record<
	OperationProfile,
	readonly HttpMethod[]
> = {
	"read-only": ["GET", "HEAD", "OPTIONS"],
	standard: ["GET", "HEAD", "OPTIONS", "POST", "PUT"],
	all: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"],
};

export function isOperationProfile(value: string): value is OperationProfile {
	return value === "read-only" || value === "standard" || value === "all";
}

export function parseOperationProfile(
	value: string | undefined,
	source: string,
): OperationProfile | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (isOperationProfile(value)) {
		return value;
	}

	throw new Error(
		`Invalid ${source}: "${value}". Expected read-only, standard, or all.`,
	);
}

export function getOperationProfileMethods(
	profile: OperationProfile,
): readonly HttpMethod[] {
	return OPERATION_PROFILE_METHODS[profile];
}

export function formatOperationProfileMethods(
	profile: OperationProfile,
): string {
	return getOperationProfileMethods(profile).join(", ");
}

export function isOpenApiLikeSourceFormat(format: SourceFormat): boolean {
	return (
		format === "openapi-3.0" ||
		format === "openapi-3.1" ||
		format === "swagger-2.0"
	);
}

export function includesToolInOperationProfile(
	tool: Pick<Tool, "method">,
	profile: OperationProfile,
): boolean {
	return getOperationProfileMethods(profile).includes(tool.method);
}

export function filterToolsByOperationProfile(
	tools: Tool[],
	profile: OperationProfile,
): Tool[] {
	return tools.filter((tool) => includesToolInOperationProfile(tool, profile));
}

export function applyOperationProfile(
	spec: RuahToolSchema,
	profile: OperationProfile,
): RuahToolSchema {
	return {
		...spec,
		tools: filterToolsByOperationProfile(spec.tools, profile),
	};
}

export function countExcludedToolsByOperationProfile(
	tools: Tool[],
	profile: OperationProfile,
): number {
	return tools.length - filterToolsByOperationProfile(tools, profile).length;
}

export function buildEmptyOperationProfileError(
	profile: OperationProfile,
): string {
	const base = `No operations matched the "${profile}" operation profile.`;
	if (profile === "all") {
		return base;
	}
	return `${base} Try '--operation-profile all' to include PATCH/DELETE operations.`;
}
