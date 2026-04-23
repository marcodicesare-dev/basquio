import assert from "node:assert/strict";

import {
  ApiError,
  RateLimiter,
  createFiberClient,
  createFirecrawlClient,
  withRetries,
} from "../packages/research/src/index";

/**
 * Smoke tests for packages/research Day 2 HTTP clients. Replaces
 * globalThis.fetch with scripted responses so no live network call
 * is made. Keeps parity with the existing tsx-based test scripts in
 * `scripts/test-*.ts` rather than pulling in Vitest for one package.
 *
 * Cases covered:
 *   - Firecrawl happy path (map + scrape + batch-scrape kickoff + poll)
 *   - Fiber happy path (email lookup + profile posts + people search)
 *   - 429 with Retry-After triggers a retry and then succeeds
 *   - 401 auth error surfaces as a non-retryable ApiError
 *   - Schema drift (unknown fields) does not break the parser
 *   - Missing apiKey throws at construction time
 */

type ScriptedResponse = {
  body: Record<string, unknown> | string;
  status?: number;
  headers?: Record<string, string>;
};

type ScriptedRequest = {
  method: "GET" | "POST";
  url: string;
  body?: Record<string, unknown>;
};

function installScriptedFetch(responses: ScriptedResponse[]) {
  const calls: ScriptedRequest[] = [];
  let cursor = 0;

  const stub = async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET") as "GET" | "POST";
    const bodyText = typeof init?.body === "string" ? init.body : undefined;
    const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : undefined;
    calls.push({ method, url, body });

    const next = responses[cursor];
    cursor += 1;
    if (!next) {
      throw new Error(`scripted fetch ran out of responses after ${cursor} calls`);
    }

    const payloadText = typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return new Response(payloadText, {
      status: next.status ?? 200,
      headers: next.headers,
    });
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;

  return {
    calls,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

async function testFirecrawlHappyPath() {
  const scripted = installScriptedFetch([
    { body: { success: true, links: [{ url: "https://mark-up.it/news/1" }] } },
    { body: { success: true, data: { markdown: "# sample" } } },
    { body: { success: true, id: "batch-123", url: "https://api.firecrawl.dev/v2/batch-scrape/batch-123" } },
    {
      body: {
        success: true,
        status: "completed",
        total: 1,
        completed: 1,
        data: [{ url: "https://mark-up.it/news/1", data: { markdown: "# done" } }],
      },
    },
  ]);

  try {
    const client = createFirecrawlClient({ apiKey: "test-key" });

    const mapped = await client.map({ url: "https://mark-up.it", search: "snack salati" });
    assert.equal(mapped.success, true);
    assert.equal(mapped.links.length, 1);

    const scraped = await client.scrape({ url: "https://mark-up.it/news/1", options: { formats: ["markdown"] } });
    assert.equal(scraped.data.markdown, "# sample");

    const kickoff = await client.batchScrape({ urls: ["https://mark-up.it/news/1"], formats: ["markdown"] });
    assert.equal(kickoff.id, "batch-123");

    const status = await client.batchScrapeStatus(kickoff.id);
    assert.equal(status.status, "completed");
    assert.equal(status.data?.[0]?.data?.markdown, "# done");

    assert.equal(scripted.calls.length, 4);
    assert.equal(scripted.calls[0]?.url, "https://api.firecrawl.dev/v2/map");
    assert.equal(scripted.calls[1]?.url, "https://api.firecrawl.dev/v2/scrape");
    assert.equal(scripted.calls[2]?.url, "https://api.firecrawl.dev/v2/batch-scrape");
    assert.equal(scripted.calls[3]?.url, "https://api.firecrawl.dev/v2/batch-scrape/batch-123");
    assert.equal(scripted.calls[3]?.method, "GET");
  } finally {
    scripted.restore();
  }
}

async function testFiberHappyPath() {
  const scripted = installScriptedFetch([
    {
      body: {
        output: {
          data: [
            {
              linkedin_url: "https://www.linkedin.com/in/mariarossi",
              full_name: "Maria Rossi",
              headline: "Head of Insights at Kellanova Italia",
              current_company: "Kellanova",
            },
          ],
        },
        chargeInfo: { credits_used: 1 },
      },
    },
    {
      body: {
        output: {
          posts: [
            { id: "p1", title: "Promo pressure Q1", url: "https://li/p/1" },
            { id: "p2", title: "Category outlook", url: "https://li/p/2" },
          ],
        },
        chargeInfo: { credits_used: 2 },
      },
    },
    {
      body: {
        output: {
          data: [{ full_name: "Giuseppe Verdi" }],
          total: 1,
          next_page_token: null,
        },
        chargeInfo: { credits_used: 1 },
      },
    },
  ]);

  try {
    const client = createFiberClient({ apiKey: "test-key" });

    const lookup = await client.lookupByEmail("maria@kellanova.com");
    assert.equal(lookup.profile?.full_name, "Maria Rossi");
    assert.equal(lookup.chargeInfo?.credits_used, 1);

    const posts = await client.fetchProfilePosts("https://www.linkedin.com/in/mariarossi");
    assert.equal(posts.posts.length, 2);

    const search = await client.peopleSearch({ currentCompany: "Kellanova", limit: 1 });
    assert.equal(search.results.length, 1);
    assert.equal(search.total, 1);
    assert.equal(search.nextPageToken, null);

    // Confirm apiKey is passed via the body, not the Authorization header.
    assert.equal(scripted.calls[0]?.body?.apiKey, "test-key");
    assert.equal(scripted.calls[0]?.body?.email, "maria@kellanova.com");
  } finally {
    scripted.restore();
  }
}

async function testRetryOn429() {
  let attemptCount = 0;
  const scripted = installScriptedFetch([
    {
      body: { message: "rate limited" },
      status: 429,
      headers: { "retry-after": "0.01" },
    },
    { body: { success: true, links: [] } },
  ]);

  try {
    const client = createFirecrawlClient({
      apiKey: "test-key",
      retryOptions: { retryCount: 3, retryBaseDelayMs: 1, label: "firecrawl-test",
        onRetry: () => {
          attemptCount += 1;
        },
      },
    });
    const response = await client.map({ url: "https://example.com" });
    assert.equal(response.success, true);
    assert.equal(scripted.calls.length, 2);
    assert.equal(attemptCount, 1);
  } finally {
    scripted.restore();
  }
}

async function testAuthErrorNonRetryable() {
  const scripted = installScriptedFetch([
    { body: { message: "invalid api key" }, status: 401 },
  ]);

  try {
    const client = createFirecrawlClient({
      apiKey: "test-key",
      retryOptions: { retryCount: 3, retryBaseDelayMs: 1 },
    });
    await assert.rejects(() => client.map({ url: "https://example.com" }), (err: unknown) => {
      if (!(err instanceof ApiError)) return false;
      assert.equal(err.status, 401);
      return true;
    });
    // Only one call should have been made; 401 is not retryable.
    assert.equal(scripted.calls.length, 1);
  } finally {
    scripted.restore();
  }
}

async function testSchemaDriftTolerance() {
  const scripted = installScriptedFetch([
    {
      body: {
        output: {
          data: [
            {
              linkedin_url: "https://www.linkedin.com/in/x",
              full_name: "X",
              extra_new_field: "fiber added this after the script was written",
            },
          ],
        },
        unknown_top_level: true,
      },
    },
  ]);

  try {
    const client = createFiberClient({ apiKey: "test-key" });
    const result = await client.lookupByEmail("x@example.com");
    // Parser MUST tolerate unknown fields. The contract is that known
    // fields are typed; unknown fields are ignored and do not throw.
    assert.equal(result.profile?.full_name, "X");
  } finally {
    scripted.restore();
  }
}

function testMissingApiKeyThrows() {
  assert.throws(() => createFirecrawlClient({ apiKey: "" }), /apiKey/);
  assert.throws(() => createFiberClient({ apiKey: "" }), /apiKey/);
}

async function testWithRetriesExhaustsBudget() {
  let attempts = 0;
  await assert.rejects(
    () =>
      withRetries(
        async () => {
          attempts += 1;
          throw new ApiError("boom", 503);
        },
        { retryCount: 2, retryBaseDelayMs: 1 },
      ),
    (err: unknown) => err instanceof ApiError && err.status === 503,
  );
  assert.equal(attempts, 3);
}

async function testRateLimiterSerializes() {
  const limiter = new RateLimiter(600);
  const minIntervalMs = Math.ceil(60_000 / 600);
  const starts: number[] = [];

  async function op(id: number) {
    starts.push(Date.now());
    await new Promise((resolve) => setTimeout(resolve, 1));
    return id;
  }

  const results = await Promise.all([
    limiter.schedule(() => op(1)),
    limiter.schedule(() => op(2)),
    limiter.schedule(() => op(3)),
  ]);

  assert.deepEqual(results, [1, 2, 3]);
  assert.equal(starts.length, 3);
  const gap01 = starts[1]! - starts[0]!;
  const gap12 = starts[2]! - starts[1]!;
  assert.ok(
    gap01 >= minIntervalMs - 1,
    `second scheduled op should start >= ${minIntervalMs}ms after first (got ${gap01}ms)`,
  );
  assert.ok(
    gap12 >= minIntervalMs - 1,
    `third scheduled op should start >= ${minIntervalMs}ms after second (got ${gap12}ms)`,
  );
}

async function testRateLimiterSurvivesThrow() {
  const limiter = new RateLimiter(600);
  await assert.rejects(
    () => limiter.schedule(async () => { throw new Error("op failed"); }),
    /op failed/,
  );
  // Subsequent calls must still resolve; the chain-promise must not be poisoned.
  const second = await limiter.schedule(async () => "ok");
  assert.equal(second, "ok");
}

async function main() {
  await testFirecrawlHappyPath();
  await testFiberHappyPath();
  await testRetryOn429();
  await testAuthErrorNonRetryable();
  await testSchemaDriftTolerance();
  testMissingApiKeyThrows();
  await testWithRetriesExhaustsBudget();
  await testRateLimiterSerializes();
  await testRateLimiterSurvivesThrow();
  console.log("research clients: firecrawl + fiber + http helpers ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
