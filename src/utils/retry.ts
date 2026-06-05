/**
 * Generic retry with exponential backoff + jitter.
 *
 * Reused by both the scraper (transient navigation/block failures) and the AI
 * analyzer (429 / 5xx from the Anthropic API). The `shouldRetry` predicate lets
 * each caller decide which errors are worth retrying.
 */

export interface RetryOptions {
  /** Max retry attempts AFTER the initial try. `2` means up to 3 total attempts. */
  maxRetries: number;
  /** Delay before the first retry, doubled each attempt. Default 1000ms. */
  baseDelayMs?: number;
  /** Upper bound for any single backoff delay. Default 8000ms. */
  maxDelayMs?: number;
  /** Decide whether a given error is retryable. Default: always retry. */
  shouldRetry?: (error: unknown) => boolean;
  /** Called before each retry sleep — useful for logging. `attempt` is 1-based. */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/** Sleep for `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn`, retrying on failure with exponential backoff: 1s, 2s, 4s, 8s...
 * (capped at `maxDelayMs`), plus up to 25% random jitter to avoid thundering
 * herds. Re-throws the last error once retries are exhausted or `shouldRetry`
 * returns false.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const {
    maxRetries,
    baseDelayMs = 1000,
    maxDelayMs = 8000,
    shouldRetry = () => true,
    onRetry,
  } = opts;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxRetries || !shouldRetry(error)) throw error;

      const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      const jitter = Math.random() * backoff * 0.25;
      const delayMs = Math.round(backoff + jitter);

      attempt += 1;
      onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }
}
