// Formatting utilities — colored output for terminal.

const useColor = !process.env.NO_COLOR;

function color(code: string, text: string): string {
	return useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export function label(): string {
	return color("36", "ruah conv");
}

export function bold(text: string): string {
	return color("1", text);
}

export function dim(text: string): string {
	return color("2", text);
}

export function green(text: string): string {
	return color("32", text);
}

export function yellow(text: string): string {
	return color("33", text);
}

export function red(text: string): string {
	return color("31", text);
}

export function cyan(text: string): string {
	return color("36", text);
}

export function logError(...args: unknown[]): void {
	console.error(red("✗"), ...args);
}

export function logWarn(...args: unknown[]): void {
	console.error(yellow("⚠"), ...args);
}

export function logSuccess(...args: unknown[]): void {
	console.log(green("✓"), ...args);
}

export function logInfo(...args: unknown[]): void {
	console.log(cyan("ℹ"), ...args);
}
