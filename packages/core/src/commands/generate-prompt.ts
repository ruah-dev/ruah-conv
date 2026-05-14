import { createInterface } from "node:readline/promises";
import {
	countExcludedToolsByOperationProfile,
	formatOperationProfileMethods,
	type OperationProfile,
} from "../generators/operation-profile.js";
import type { RuahToolSchema } from "../ir/schema.js";
import { bold, logInfo, logWarn } from "../utils/format.js";

const PROMPT_OPTIONS: Array<{
	key: string;
	profile: OperationProfile;
	label: string;
}> = [
	{ key: "1", profile: "read-only", label: "Read-only" },
	{ key: "2", profile: "standard", label: "Standard" },
	{ key: "3", profile: "all", label: "All" },
];

export async function promptForOperationProfile(
	spec: RuahToolSchema,
): Promise<OperationProfile> {
	const readline = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	const abortController = new AbortController();
	const handleSigint = () => abortController.abort();
	process.once("SIGINT", handleSigint);

	try {
		console.log();
		console.log(bold("Operation Profile"));
		logInfo(
			"Choose how much write capability to expose from this OpenAPI/Swagger spec.",
		);

		for (const option of PROMPT_OPTIONS) {
			const excluded = countExcludedToolsByOperationProfile(
				spec.tools,
				option.profile,
			);
			const included = spec.tools.length - excluded;
			const noun = excluded === 1 ? "operation" : "operations";
			console.log(
				`  ${option.key}. ${option.label}  ${formatOperationProfileMethods(option.profile)}  (${included} included, ${excluded} excluded ${noun})`,
			);
		}

		console.log();

		for (;;) {
			const answer = await readline.question("Select profile [2]: ", {
				signal: abortController.signal,
			});
			const trimmed = answer.trim();

			if (trimmed === "" || trimmed === "2") {
				return "standard";
			}
			if (trimmed === "1") {
				return "read-only";
			}
			if (trimmed === "3") {
				return "all";
			}

			logWarn("Invalid selection. Enter 1, 2, 3, or press Enter.");
		}
	} catch (error) {
		if (abortController.signal.aborted) {
			throw new Error("Operation profile selection cancelled.");
		}
		throw error;
	} finally {
		process.off("SIGINT", handleSigint);
		readline.close();
	}
}
