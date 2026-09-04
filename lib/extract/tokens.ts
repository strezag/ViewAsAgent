/**
 * Token counts are the unit that matters to an agent: context windows and
 * per-request cost are denominated in tokens, not bytes. o200k_base is the
 * encoding behind the current GPT and Claude-adjacent tooling, and it is close
 * enough across frontier models for the comparison this tool makes.
 *
 * The encoder is a large table, so it loads lazily — the panel should open
 * instantly and only pay for the tokenizer when an audit actually runs.
 */

type Encoder = (text: string) => number[];

let encoderPromise: Promise<Encoder | null> | null = null;

async function loadEncoder(): Promise<Encoder | null> {
  try {
    const module = await import('gpt-tokenizer/encoding/o200k_base');
    return module.encode as Encoder;
  } catch (err) {
    console.warn('[ViewAsAgent] tokenizer unavailable, falling back to an estimate:', err);
    return null;
  }
}

/**
 * A deliberately crude fallback. Roughly four characters per token holds well
 * enough for English prose to keep the UI honest if the encoder fails to load.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Above this, exact tokenization costs more than the precision is worth —
 * a 2 MB HTML payload would block the panel for seconds.
 */
const MAX_EXACT_TOKENIZE = 500_000;

export async function countTokens(text: string): Promise<number> {
  if (!text) return 0;
  if (text.length > MAX_EXACT_TOKENIZE) return estimateTokens(text);
  encoderPromise ??= loadEncoder();
  const encode = await encoderPromise;
  if (!encode) return estimateTokens(text);
  try {
    return encode(text).length;
  } catch {
    return estimateTokens(text);
  }
}

/** Warm the encoder so the first audit does not pay the load cost inline. */
export function preloadTokenizer(): void {
  encoderPromise ??= loadEncoder();
}
