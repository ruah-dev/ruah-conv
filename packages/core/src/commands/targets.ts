import type { ParsedArgs } from "../cli.js";
import { getTargets } from "../generators/index.js";
import { bold, cyan, dim } from "../utils/format.js";

export async function run(args: ParsedArgs): Promise<void> {
	const jsonMode = Boolean(args.flags.json);
	const targets = getTargets();

	if (jsonMode) {
		process.stdout.write(JSON.stringify(targets, null, 2));
		process.stdout.write("\n");
		return;
	}

	console.log();
	console.log(bold("Available Targets"));
	console.log(dim("─".repeat(50)));
	for (const target of targets) {
		console.log(`  ${cyan(target.id)}`);
		console.log(`    ${target.description}`);
	}
	console.log();
}
