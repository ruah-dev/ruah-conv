#!/usr/bin/env node
// prepare-release.mjs — sync version across root package.json, packages/core/package.json,
// .claude/governance.md, and CHANGELOG.md.
//
// Usage:  npm run prepare-release -- --version vX.Y.Z
//
// This script does NOT commit, tag, or push. It only edits files and prints the
// next-step git commands. The human runs them.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function die(msg) {
	console.error(`prepare-release: ${msg}`);
	process.exit(1);
}

// --- arg parsing ---
const argv = process.argv.slice(2);
const versionIdx = argv.indexOf("--version");
if (versionIdx === -1 || !argv[versionIdx + 1]) {
	die("missing --version flag.\n  usage: npm run prepare-release -- --version vX.Y.Z");
}
const rawVersion = argv[versionIdx + 1];
const version = rawVersion.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
	die(`invalid version '${rawVersion}' — must look like v1.2.3 or 1.2.3-beta.1`);
}
const tag = `v${version}`;

// --- file paths ---
const rootPkgPath = resolve(repoRoot, "package.json");
const corePkgPath = resolve(repoRoot, "packages/core/package.json");
const governancePath = resolve(repoRoot, ".claude/governance.md");
const changelogPath = resolve(repoRoot, "CHANGELOG.md");

// --- 1. bump root package.json ---
const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
const oldVersion = rootPkg.version;
rootPkg.version = version;
writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, "\t")}\n`);

// --- 2. bump packages/core/package.json ---
const corePkg = JSON.parse(readFileSync(corePkgPath, "utf8"));
corePkg.version = version;
writeFileSync(corePkgPath, `${JSON.stringify(corePkg, null, "\t")}\n`);

// --- 3. update governance.md version line ---
// Matches: "- Version: 0.4.0 (published on npm)" or "Version: v0.4.0"
const governance = readFileSync(governancePath, "utf8");
const govRe = /(Version:[ \t]*)v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?/;
if (!govRe.test(governance)) {
	die(`could not find a 'Version: X.Y.Z' line in ${governancePath}`);
}
writeFileSync(governancePath, governance.replace(govRe, `$1${version}`));

// --- 4. insert CHANGELOG section above [Unreleased] ---
const today = new Date().toISOString().slice(0, 10);
const changelog = readFileSync(changelogPath, "utf8");
const unreleasedRe = /^## \[Unreleased\][^\n]*$/m;
if (!unreleasedRe.test(changelog)) {
	die("CHANGELOG.md does not contain a '## [Unreleased]' header");
}
// Insert a stub release section directly above [Unreleased]. The human moves
// items from Unreleased into the new section before committing.
const newSection = `## [${version}] - ${today}\n\n### Added\n\n- _Describe new features here._\n\n### Fixed\n\n- _Describe bug fixes here._\n\n`;
const replaced = changelog.replace(unreleasedRe, `${newSection}## [Unreleased]`);
writeFileSync(changelogPath, replaced);

// --- 5. report next steps ---
console.log(`prepare-release: bumped ${oldVersion} -> ${version}`);
console.log("");
console.log("Files updated:");
console.log("  - package.json");
console.log("  - packages/core/package.json");
console.log("  - .claude/governance.md");
console.log("  - CHANGELOG.md (new section header inserted; fill it in before committing)");
console.log("");
console.log("Next steps:");
console.log(`  git checkout -b release/${tag}`);
console.log("  # edit CHANGELOG.md to flesh out the new section");
console.log("  git add -A");
console.log(`  git commit -m "release(conv): ${tag}"`);
console.log(`  git push -u origin release/${tag}`);
console.log("  # after PR merges to main:");
console.log(`  git checkout main && git pull`);
console.log(`  git tag ${tag} && git push origin ${tag}`);
console.log("");
console.log("The release.yml workflow will publish to npm once the tag is pushed.");
