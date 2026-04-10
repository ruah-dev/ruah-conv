import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

try {
	require.resolve("@ruah-dev/cli/package.json");
} catch {
	console.warn(
		"[@ruah-dev/conv] Top-level CLI not detected. Install @ruah-dev/cli for the `ruah conv` command. Standalone binary: `ruah-conv`.",
	);
}
