/**
 * Shared HTTP helpers for the research package.
 *
 * Extracts the ApiError + RateLimiter + postJson + withRetries pattern
 * from `scripts/contact-enrichment.ts:614-810` into a clean module that
 * firecrawl-client.ts and fiber-client.ts both consume. Scripts stay as
 * ETL tools; packages/research is the production path.
 *
 * Docs: docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md
 * §2.9 (the existing patterns), §5.7 (the Fiber routing rationale).
 *
 * Nothing here imports from scripts/. Clean-room extraction.
 */

/**
 * HTTP error with a machine-readable status code and an optional
 * Retry-After hint parsed from the server response. Retryable errors
 * (429, 5xx, network errors) propagate until the caller's retry budget
 * is exhausted.
 */
export class ApiError extends Error {
  status: number;
  retryAfterMs: number | null;

  constructor(message: string, status: number, retryAfterMs: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Serialized rate limiter. Ensures at most `requestsPerMinute` operations
 * are dispatched per 60-second window, chained strictly in order. Useful
 * when the upstream API's free/Hobby tier is the binding constraint.
 *
 * Chain-promise pattern rather than token-bucket so a burst of enqueued
 * calls serializes cleanly instead of firing in parallel after a cache
 * miss. Matches the semantics of `scripts/contact-enrichment.ts:626-645`.
 */
export class RateLimiter {
  private nextAvailableAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly requestsPerMinute: number) {}

  async schedule<T>(operation: () => Promise<T>): Promise<T> {
    const minIntervalMs = Math.ceil(60_000 / Math.max(this.requestsPerMinute, 1));
    const scheduled = this.chain.then(async () => {
      const waitMs = Math.max(0, this.nextAvailableAt - Date.now());
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      this.nextAvailableAt = Math.max(this.nextAvailableAt, Date.now()) + minIntervalMs;
      return operation();
    });
    this.chain = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type PostJsonInit = {
  headers?: Record<string, string>;
  body: Record<string, unknown>;
  signal?: AbortSignal;
};

/**
 * POST JSON to `url` and parse the response body as JSON of type `T`.
 * Throws an `ApiError` with status, message, and Retry-After hint on
 * any non-2xx status. Assumes application/json; calls that need other
 * content types should inline their own fetch.
 */
export async function postJson<T>(url: string, init: PostJsonInit): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(init.body),
    signal: init.signal,
  });

  return parseJsonResponse<T>(response);
}

/**
 * GET JSON from `url` and parse the response body as JSON of type `T`.
 * Same error semantics as `postJson`. Used for the Firecrawl crawl-status
 * poll endpoint.
 */
export async function getJson<T>(
  url: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      ...(init.headers ?? {}),
    },
    signal: init.signal,
  });

  return parseJsonResponse<T>(response);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!response.ok) {
    let message: string | null = null;
    if (text) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object" && "message" in parsed) {
          message = String((parsed as Record<string, unknown>).message);
        }
      } catch {
        // body was non-JSON; fall through to status-line message
      }
    }
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number.parseFloat(retryAfterHeader) * 1000 : null;
    throw new ApiError(
      message ?? `${response.status} ${response.statusText}`,
      response.status,
      Number.isFinite(retryAfterMs) ? retryAfterMs : null,
    );
  }

  if (!text) {
    // Empty-body 2xx with a caller expecting JSON is a contract violation.
    // Surface as a retryable 502-equivalent so callers do not get a silently
    // typed `{} as T` that crashes on first access.
    throw new ApiError("upstream returned empty body on 2xx response", 502);
  }

  return JSON.parse(text) as T;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiError) {
    // 408 request timeout, 425 too early, 429 rate limited, 5xx server
    // errors are retryable. 409 conflict is NOT retryable: Firecrawl and
    // Fiber use it for idempotency clashes, which retry storms only make
    // worse. 401/403/404 are also non-retryable by omission.
    return (
      error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500
    );
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("socket hang up")
  );
}

/**
 * Maximum delay between retry attempts in milliseconds. Guards against a
 * hostile or misconfigured `Retry-After` header (e.g., 3600) making the
 * client sleep for an hour in a worker process. 60 seconds is plenty for
 * any legitimate rate-limit window; anything longer is a real outage and
 * should propagate.
 */
export const DEFAULT_RETRY_MAX_DELAY_MS = 60_000;

export function retryDelayMs(
  error: unknown,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number = DEFAULT_RETRY_MAX_DELAY_MS,
): number {
  if (error instanceof ApiError && error.retryAfterMs && error.retryAfterMs > 0) {
    return Math.min(error.retryAfterMs, maxDelayMs);
  }
  return Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
}

export type RetryOptions = {
  retryCount: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs?: number;
  label?: string;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
};

/**
 * Run `operation` with exponential-backoff retry until the budget is
 * exhausted or a non-retryable error is raised. Honors Retry-After when
 * present; otherwise doubles on each attempt.
 *
 * `label` is surfaced via `onRetry` for caller-side logging but never
 * printed by the helper itself; callers decide their own observability
 * posture.
 */
export async function withRetries<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= options.retryCount || !isRetryableError(error)) {
        throw error;
      }
      const delayMs = retryDelayMs(
        error,
        attempt,
        options.retryBaseDelayMs,
        options.retryMaxDelayMs,
      );
      if (options.onRetry) {
        options.onRetry(error, attempt, delayMs);
      }
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

/**
 * Default retry policy shared by Firecrawl and Fiber clients. Five
 * attempts at 500ms base interval (so total wait up to ~16s for a
 * sequence of 500ms, 1s, 2s, 4s, 8s) covers typical transient blips
 * without masking real outages.
 */
export const DEFAULT_RETRY_OPTIONS: Omit<RetryOptions, "label" | "onRetry"> = {
  retryCount: 5,
  retryBaseDelayMs: 500,
};
