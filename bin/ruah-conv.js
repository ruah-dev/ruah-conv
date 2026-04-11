#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cliPath = require.resolve("@ruah-dev/conv-core/dist/cli.js");

const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], {
	stdio: "inherit",
});

process.exit(result.status ?? 1);
