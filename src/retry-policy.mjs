const DEFAULT_MAX_RETRIES = 3;

/**
 * Resolve a retry policy from a nonnegative safe integer, null, or missing count.
 * Null and missing counts use the default.
 * @param {{ maxRetries?: number | null }} [options]
 * @returns {{ maxRetries: number }}
 */
export function resolveRetryPolicy(options = {}) {
  return { maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES };
}
