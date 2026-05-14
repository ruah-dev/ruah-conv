import {
	DEFAULT_OPERATION_PROFILE,
	isOpenApiLikeSourceFormat,
	type OperationProfile,
} from "../generators/operation-profile.js";
import type { SourceFormat } from "../ir/schema.js";

export type OperationProfileResolution =
	| { kind: "none" }
	| {
			kind: "resolved";
			profile: OperationProfile;
			source: "flag" | "config" | "default";
	  }
	| { kind: "prompt"; defaultProfile: OperationProfile };

export interface ResolveOperationProfileOptions {
	sourceFormat: SourceFormat;
	jsonMode: boolean;
	stdinIsTTY: boolean;
	stdoutIsTTY: boolean;
	ci: boolean;
	explicitProfile?: OperationProfile;
	configProfile?: OperationProfile;
}

export function resolveOperationProfile(
	options: ResolveOperationProfileOptions,
): OperationProfileResolution {
	if (!isOpenApiLikeSourceFormat(options.sourceFormat)) {
		return { kind: "none" };
	}

	if (options.explicitProfile) {
		return {
			kind: "resolved",
			profile: options.explicitProfile,
			source: "flag",
		};
	}

	if (options.configProfile) {
		return {
			kind: "resolved",
			profile: options.configProfile,
			source: "config",
		};
	}

	if (shouldPromptForOperationProfile(options)) {
		return {
			kind: "prompt",
			defaultProfile: DEFAULT_OPERATION_PROFILE,
		};
	}

	return {
		kind: "resolved",
		profile: DEFAULT_OPERATION_PROFILE,
		source: "default",
	};
}

function shouldPromptForOperationProfile(
	options: ResolveOperationProfileOptions,
): boolean {
	return (
		!options.jsonMode &&
		options.stdinIsTTY &&
		options.stdoutIsTTY &&
		!options.ci
	);
}
