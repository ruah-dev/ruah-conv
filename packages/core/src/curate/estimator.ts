/**
 * Hand-rolled token estimator — zero dependencies, no network, no model files.
 *
 * // sync-with: ruah-opt/src/estimator.ts
 *
 * Heuristic: modern BPE vocabularies average ~4 characters per token on
 * English prose, and ~1.3 tokens per word. Dense text (code, minified JSON)
 * skews the per-word ratio low — so we blend the two estimates.
 *
 * Expect roughly ±20% versus a real tokenizer. Good enough for definition
 * footprint reports; do not use for billing.
 */

const CHARS_PER_TOKEN = 4;
const TOKENS_PER_WORD = 1.32;

export interface TokenEstimate {
	tokens: number;
	chars: number;
	words: number;
	lines: number;
}

export function estimateText(text: string): TokenEstimate {
	const chars = text.length;
	if (chars === 0) {
		return { tokens: 0, chars: 0, words: 0, lines: 0 };
	}
	const words = text.match(/\S+/g)?.length ?? 0;
	const lines = text.split("\n").length;
	const charEstimate = chars / CHARS_PER_TOKEN;
	const wordEstimate = words * TOKENS_PER_WORD;
	const blended =
		words === 0 ? charEstimate : (charEstimate + wordEstimate) / 2;
	const tokens = Math.max(1, Math.round(blended));
	return { tokens, chars, words, lines };
}

export function estimateTokens(text: string): number {
	return estimateText(text).tokens;
}

/** Definition-footprint estimate for a JSON-serializable value. */
export function estimateDefinitionTokens(value: unknown): number {
	return estimateTokens(JSON.stringify(value));
}
