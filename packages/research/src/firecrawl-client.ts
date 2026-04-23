/**
 * Firecrawl v2 client.
 *
 * Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md §4.
 * Covers six v2 endpoints used by the research package:
 *
 *   - `/v2/map`          URL discovery, first call per source (§4.1)
 *   - `/v2/batch-scrape` bulk scrape of mapped URLs (§4.2)
 *   - `/v2/crawl`        deep recursive crawl for catalog onboarding (§4.3)
 *   - `/v2/search`       cross-catalog search for open queries (§4.4)
 *   - `/v2/scrape`       single URL fallback (§4.5)
 *   - `GET /v2/batch-scrape/{id}` and `GET /v2/crawl/{id}` status polls
 *
 * LinkedIn paths do NOT flow through this client. The `linkedin_fiber`
 * source_type routes to fiber-client.ts per §5.7. Do not add a LinkedIn
 * endpoint here.
 *
 * Bearer-token auth from `FIRECRAWL_API_KEY`. Rate limiter defaults to
 * Standard-tier concurrency (500 scrape req/min) per Marco's 2026-04-23
 * decision; callers may override for Hobby tier if tier drops.
 */

import {
  ApiError,
  DEFAULT_RETRY_OPTIONS,
  RateLimiter,
  getJson,
  postJson,
  withRetries,
  type RetryOptions,
} from "./http";

const FIRECRAWL_BASE_URL_DEFAULT = "https://api.firecrawl.dev";
const FIRECRAWL_STANDARD_RPM = 500;

export type FirecrawlFormat = "markdown" | "html" | "links" | "rawHtml" | "screenshot";

export type FirecrawlLocation = {
  country?: string;
  languages?: string[];
};

export type FirecrawlProxyMode = "auto" | "basic" | "enhanced";

export type FirecrawlScrapeOptions = {
  formats?: FirecrawlFormat[];
  onlyMainContent?: boolean;
  waitFor?: number;
  blockAds?: boolean;
  proxy?: FirecrawlProxyMode;
  location?: FirecrawlLocation;
  includeTags?: string[];
  excludeTags?: string[];
  timeout?: number;
};

export type FirecrawlMapRequest = {
  url: string;
  search?: string;
  sitemap?: "include" | "skip" | "only";
  includeSubdomains?: boolean;
  ignoreQueryParameters?: boolean;
  limit?: number;
  location?: FirecrawlLocation;
  ignoreCache?: boolean;
  signal?: AbortSignal;
};

export type FirecrawlMapLink = {
  url: string;
  title?: string;
  description?: string;
};

export type FirecrawlMapResponse = {
  success: boolean;
  links: FirecrawlMapLink[];
  creditsUsed?: number;
};

export type FirecrawlScrapeRequest = {
  url: string;
  options?: FirecrawlScrapeOptions;
  signal?: AbortSignal;
};

export type FirecrawlScrapeData = {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  screenshot?: string;
  metadata?: Record<string, unknown>;
};

export type FirecrawlScrapeResponse = {
  success: boolean;
  data: FirecrawlScrapeData;
  creditsUsed?: number;
};

export type FirecrawlBatchScrapeRequest = {
  urls: string[];
  formats?: FirecrawlFormat[];
  onlyMainContent?: boolean;
  waitFor?: number;
  blockAds?: boolean;
  proxy?: FirecrawlProxyMode;
  location?: FirecrawlLocation;
  maxConcurrency?: number;
  ignoreInvalidURLs?: boolean;
  webhook?: {
    url: string;
    headers?: Record<string, string>;
  };
  signal?: AbortSignal;
};

export type FirecrawlBatchScrapeKickoff = {
  success: boolean;
  id: string;
  url: string;
};

/**
 * Batch-scrape status response. Shape verified against live Firecrawl
 * v2 on 2026-04-23 Day 4 smoke probe: `data` is a flat array of scrape
 * results, each with `markdown` / `html` / etc. directly on the item
 * (no nested `.data`) and the source URL available at
 * `metadata.sourceURL`. Earlier type (nested `{url, data}`) caused the
 * Day 4 smoke to persist zero scrapes despite successful fetches.
 */
export type FirecrawlBatchScrapeStatus = {
  success: boolean;
  status: "scraping" | "completed" | "failed" | "cancelled";
  total: number;
  completed: number;
  creditsUsed?: number;
  expiresAt?: string;
  data?: Array<FirecrawlScrapeData & { error?: string | null }>;
};

export type FirecrawlCrawlRequest = {
  url: string;
  includePaths?: string[];
  excludePaths?: string[];
  limit?: number;
  maxDiscoveryDepth?: number;
  crawlEntireDomain?: boolean;
  sitemap?: "include" | "skip" | "only";
  maxConcurrency?: number;
  scrapeOptions?: FirecrawlScrapeOptions;
  webhook?: {
    url: string;
    headers?: Record<string, string>;
  };
  signal?: AbortSignal;
};

export type FirecrawlCrawlKickoff = {
  success: boolean;
  id: string;
  url: string;
};

export type FirecrawlCrawlStatus = {
  success: boolean;
  status: "scraping" | "completed" | "failed" | "cancelled";
  total: number;
  completed: number;
  creditsUsed?: number;
  data?: Array<{
    url: string;
    data?: FirecrawlScrapeData;
    error?: string;
  }>;
};

export type FirecrawlSearchRequest = {
  query: string;
  limit?: number;
  tbs?: string;
  country?: string;
  sources?: Array<"web" | "news" | "images">;
  scrapeOptions?: Pick<FirecrawlScrapeOptions, "formats" | "onlyMainContent" | "blockAds">;
  signal?: AbortSignal;
};

export type FirecrawlSearchResult = {
  url: string;
  title?: string;
  description?: string;
  data?: FirecrawlScrapeData;
};

export type FirecrawlSearchResponse = {
  success: boolean;
  data: FirecrawlSearchResult[];
  creditsUsed?: number;
};

export type FirecrawlClientOptions = {
  apiKey: string;
  baseUrl?: string;
  requestsPerMinute?: number;
  retryOptions?: RetryOptions;
};

/**
 * Create a rate-limited, retry-aware Firecrawl v2 client. All methods
 * throw `ApiError` on non-retryable failure after the retry budget is
 * exhausted.
 *
 * Graceful-degradation contract (spec §5.7): the Day 4 fetcher MUST wrap
 * this constructor in try/catch and, on missing `FIRECRAWL_API_KEY`,
 * disable the corresponding `source_catalog` rows catalog-wide with a
 * clear operator-visible error rather than killing the whole research
 * phase. Throwing here is the primitive-level signal; the fetcher is the
 * integration boundary that enforces the degradation.
 */
export function createFirecrawlClient(options: FirecrawlClientOptions) {
  if (!options.apiKey) {
    throw new Error("createFirecrawlClient requires an apiKey. Set FIRECRAWL_API_KEY in env.");
  }
  const baseUrl = options.baseUrl ?? FIRECRAWL_BASE_URL_DEFAULT;
  const limiter = new RateLimiter(options.requestsPerMinute ?? FIRECRAWL_STANDARD_RPM);
  const retry: RetryOptions = options.retryOptions ?? {
    ...DEFAULT_RETRY_OPTIONS,
    label: "firecrawl",
  };
  const authHeader = { Authorization: `Bearer ${options.apiKey}` };

  async function call<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    return withRetries(
      () => limiter.schedule(() => postJson<T>(`${baseUrl}${path}`, { headers: authHeader, body, signal })),
      retry,
    );
  }

  async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return withRetries(
      () => limiter.schedule(() => getJson<T>(`${baseUrl}${path}`, { headers: authHeader, signal })),
      retry,
    );
  }

  return {
    /**
     * URL discovery against a single source. Returns the candidate link
     * list; the caller filters against the source's crawl_allow and
     * crawl_deny regexes in packages/research/src/fetcher.ts.
     */
    map(req: FirecrawlMapRequest): Promise<FirecrawlMapResponse> {
      const { signal, ...body } = req;
      return call<FirecrawlMapResponse>("/v2/map", body as Record<string, unknown>, signal);
    },

    /**
     * Single-URL scrape fallback. Used when the planner identifies a
     * specific URL rather than a source to discover from.
     */
    scrape(req: FirecrawlScrapeRequest): Promise<FirecrawlScrapeResponse> {
      const { signal, options: scrapeOptions, url } = req;
      const body: Record<string, unknown> = { url };
      if (scrapeOptions) Object.assign(body, scrapeOptions);
      return call<FirecrawlScrapeResponse>("/v2/scrape", body, signal);
    },

    /**
     * Batch scrape of N URLs. Returns an async job id; poll via
     * `batchScrapeStatus(id)` until `status === "completed"` or the
     * caller's deadline expires. Fetcher default deadline 180 s per
     * query per spec §5.3.
     */
    batchScrape(req: FirecrawlBatchScrapeRequest): Promise<FirecrawlBatchScrapeKickoff> {
      const { signal, ...body } = req;
      return call<FirecrawlBatchScrapeKickoff>("/v2/batch/scrape", body as Record<string, unknown>, signal);
    },

    batchScrapeStatus(id: string, signal?: AbortSignal): Promise<FirecrawlBatchScrapeStatus> {
      return get<FirecrawlBatchScrapeStatus>(`/v2/batch/scrape/${encodeURIComponent(id)}`, signal);
    },

    /**
     * Deep recursive crawl. Not used per-deck. Reserved for catalog
     * onboarding (Week 3 stretch days per spec §9).
     */
    crawl(req: FirecrawlCrawlRequest): Promise<FirecrawlCrawlKickoff> {
      const { signal, ...body } = req;
      return call<FirecrawlCrawlKickoff>("/v2/crawl", body as Record<string, unknown>, signal);
    },

    crawlStatus(id: string, signal?: AbortSignal): Promise<FirecrawlCrawlStatus> {
      return get<FirecrawlCrawlStatus>(`/v2/crawl/${encodeURIComponent(id)}`, signal);
    },

    /**
     * Cross-catalog search. Call when the planner decides the brief
     * needs site: searches across the catalog. Per spec §4.4, scope to
     * catalog hosts in the query itself; the endpoint does not support
     * a site-filter array.
     */
    search(req: FirecrawlSearchRequest): Promise<FirecrawlSearchResponse> {
      const { signal, ...body } = req;
      return call<FirecrawlSearchResponse>("/v2/search", body as Record<string, unknown>, signal);
    },
  } as const;
}

export type FirecrawlClient = ReturnType<typeof createFirecrawlClient>;

export { ApiError };
