import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export interface WriteableFile {
	path: string;
	content: string;
}

export interface WriteGeneratedFilesOptions {
	onWrite?: (absolutePath: string) => void;
}

/**
 * Write a set of generator-emitted files into `outDir`, creating any nested
 * parent directories as needed. The scaffold-integrity rule (see governance.md)
 * requires every generator with `emits: "files"` to round-trip through this
 * helper so each entry lands on disk.
 */
export function writeGeneratedFiles(
	files: ReadonlyArray<WriteableFile>,
	outDir: string,
	options: WriteGeneratedFilesOptions = {},
): string[] {
	const absOutput = resolve(outDir);
	mkdirSync(absOutput, { recursive: true });

	const written: string[] = [];
	for (const file of files) {
		const filePath = resolve(absOutput, file.path);
		// Containment check: reject path-traversal (../..) or absolute paths
		// that resolve outside the output directory.
		const rel = relative(absOutput, filePath);
		if (rel.startsWith("..") || isAbsolute(rel)) {
			throw new Error(
				`Refusing to write outside output directory: ${file.path}`,
			);
		}
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, file.content, "utf8");
		written.push(filePath);
		options.onWrite?.(filePath);
	}
	return written;
}
