/**
 * Fiber AI v1 client for LinkedIn intelligence.
 *
 * Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md
 * §2.9 and §5.7. Fiber is LinkedIn-partnered and is the ToS-safe path
 * for any LinkedIn data the workspace needs. Firecrawl must NOT scrape
 * LinkedIn; the dual-client fetcher routes `source_type='linkedin_fiber'`
 * catalog rows to this client instead.
 *
 * Three v1 endpoints:
 *
 *   - `/v1/email-to-person/single`        email to profile lookup
 *   - `/v1/linkedin-live-fetch/profile-posts`  recent posts by profile URL
 *   - `/v1/people-search`                 structured search for profiles
 *
 * Bearer token from `FIBER_API_KEY`. Base URL from `FIBER_BASE_URL`
 * with fallback to `https://api.fiber.ai`. Auth is sent as the
 * `apiKey` body parameter rather than an Authorization header, matching
 * the existing script pattern in `scripts/contact-enrichment.ts:809-863`.
 *
 * Coresignal-style webhook alerts for job moves are explicitly out of
 * scope for v1 per spec §10 R9. If you find yourself reaching for
 * polling to substitute, stop and revisit.
 */

import {
  ApiError,
  DEFAULT_RETRY_OPTIONS,
  RateLimiter,
  postJson,
  withRetries,
  type RetryOptions,
} from "./http";

const FIBER_BASE_URL_DEFAULT = "https://api.fiber.ai";
const FIBER_DEFAULT_RPM = 60;

export type FiberChargeInfo = {
  credits_used?: number;
  credits_remaining?: number;
};

export type FiberLocation = {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  country_code?: string | null;
};

export type FiberExperience = {
  title?: string | null;
  company?: string | null;
  company_linkedin_url?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  description?: string | null;
  is_current?: boolean | null;
};

export type FiberArticle = {
  id?: string | null;
  title?: string | null;
  url?: string | null;
  published_at?: string | null;
  text?: string | null;
  author_linkedin_url?: string | null;
  reactions_count?: number | null;
  comments_count?: number | null;
};

export type FiberProfile = {
  linkedin_url?: string | null;
  entity_urn?: string | null;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  headline?: string | null;
  current_title?: string | null;
  current_company?: string | null;
  current_company_linkedin_url?: string | null;
  follower_count?: number | null;
  connection_count?: number | null;
  inferred_location?: FiberLocation | null;
  experiences?: FiberExperience[] | null;
  articles?: FiberArticle[] | null;
};

export type FiberLookupResponse = {
  output?: {
    data?: FiberProfile[] | null;
  };
  chargeInfo?: FiberChargeInfo | null;
};

export type FiberPostsResponse = {
  output?: {
    posts?: FiberArticle[] | null;
    data?: FiberArticle[] | null;
  };
  chargeInfo?: FiberChargeInfo | null;
};

export type FiberPeopleSearchQuery = {
  keywords?: string;
  currentCompany?: string;
  currentTitle?: string;
  locationCountry?: string;
  locationCity?: string;
  // Day 4 must verify the `industries` parameter shape against the Fiber
  // v1 docs before the first live call. Candidate alternatives observed
  // in other Fiber-partnered tools: `industry` as a single string, or a
  // Fiber-specific enum. Keep as string[] for now; if rejected at call
  // time, fall back to the first element or convert to the canonical
  // shape per live error message.
  industries?: string[];
  limit?: number;
};

export type FiberPeopleSearchResponse = {
  output?: {
    data?: FiberProfile[] | null;
    total?: number | null;
    next_page_token?: string | null;
  };
  chargeInfo?: FiberChargeInfo | null;
};

export type FiberClientOptions = {
  apiKey: string;
  baseUrl?: string;
  requestsPerMinute?: number;
  retryOptions?: RetryOptions;
};

/**
 * Create a rate-limited, retry-aware Fiber v1 client. The returned
 * object has one method per v1 endpoint in use today.
 *
 * Graceful-degradation contract (spec §5.7): the Day 4 fetcher MUST wrap
 * this constructor in try/catch and, on missing `FIBER_API_KEY`, disable
 * every `source_catalog` row with `source_type='linkedin_fiber'` and log
 * a clear operator-visible error. Non-LinkedIn catalog rows continue to
 * work through the Firecrawl client. Throwing here is the primitive-
 * level signal; the fetcher is the integration boundary.
 */
export function createFiberClient(options: FiberClientOptions) {
  if (!options.apiKey) {
    throw new Error("createFiberClient requires an apiKey. Set FIBER_API_KEY in env.");
  }
  const baseUrl = options.baseUrl ?? FIBER_BASE_URL_DEFAULT;
  const limiter = new RateLimiter(options.requestsPerMinute ?? FIBER_DEFAULT_RPM);
  const retry: RetryOptions = options.retryOptions ?? {
    ...DEFAULT_RETRY_OPTIONS,
    label: "fiber",
  };

  async function call<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    return withRetries(
      () =>
        limiter.schedule(() =>
          postJson<T>(`${baseUrl}${path}`, {
            body: { apiKey: options.apiKey, ...body },
            signal,
          }),
        ),
      retry,
    );
  }

  return {
    /**
     * Resolve an email address to a LinkedIn profile plus recent
     * experience and article history. Null when the email is not found
     * in Fiber's 850M-profile index.
     */
    async lookupByEmail(email: string, signal?: AbortSignal): Promise<{
      profile: FiberProfile | null;
      chargeInfo: FiberChargeInfo | null;
    }> {
      const response = await call<FiberLookupResponse>("/v1/email-to-person/single", { email }, signal);
      const profiles = response.output?.data ?? [];
      return {
        profile: profiles[0] ?? null,
        chargeInfo: response.chargeInfo ?? null,
      };
    },

    /**
     * Fetch recent posts by LinkedIn profile URL. Used by the research
     * package to surface "what is this stakeholder saying publicly this
     * month" during brief synthesis.
     */
    async fetchProfilePosts(linkedinUrl: string, signal?: AbortSignal): Promise<{
      posts: FiberArticle[];
      chargeInfo: FiberChargeInfo | null;
    }> {
      const response = await call<FiberPostsResponse>(
        "/v1/linkedin-live-fetch/profile-posts",
        { linkedinUrl },
        signal,
      );
      const posts = response.output?.posts ?? response.output?.data ?? [];
      return {
        posts,
        chargeInfo: response.chargeInfo ?? null,
      };
    },

    /**
     * Structured people search. Takes title, company, industry, location
     * filters and returns matching profiles. New v1 addition (not yet
     * wired elsewhere in the repo). Used by the fetcher when a brief
     * names a client company rather than a specific email.
     */
    async peopleSearch(query: FiberPeopleSearchQuery, signal?: AbortSignal): Promise<{
      results: FiberProfile[];
      total: number;
      nextPageToken: string | null;
      chargeInfo: FiberChargeInfo | null;
    }> {
      const response = await call<FiberPeopleSearchResponse>("/v1/people-search", { ...query }, signal);
      return {
        results: response.output?.data ?? [],
        total: response.output?.total ?? 0,
        nextPageToken: response.output?.next_page_token ?? null,
        chargeInfo: response.chargeInfo ?? null,
      };
    },
  } as const;
}

export type FiberClient = ReturnType<typeof createFiberClient>;

export { ApiError };
