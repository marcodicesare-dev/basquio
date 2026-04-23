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

/**
 * Shape verified against Fiber v1 /v1/people-search on 2026-04-24 (B4d).
 * scripts/probe-fiber-industries.ts is the reproducer. Fields marked
 * "verified" were observed in a live response; fields marked "optional
 * convenience alias" may be emitted as null and should not be relied
 * on by the fetcher. The canonical fetcher reads url + name + email +
 * industry_name + current_job.
 */
export type FiberProfile = {
  // ── Verified top-level fields ────────────────────────────────────
  url?: string | null;                    // verified: "https://www.linkedin.com/in/<slug>"
  user_id?: string | null;                // verified
  entity_urn?: string | null;             // verified
  entity_urns?: string[] | null;          // verified (plural)
  name?: string | null;                   // verified: full display name
  first_name?: string | null;             // verified
  last_name?: string | null;              // verified
  headline?: string | null;               // verified: LinkedIn headline
  industry_name?: string | null;          // verified: singular, not array
  locality?: string | null;               // verified
  inferred_location?: FiberLocation | null;
  summary?: string | null;                // verified: about / bio
  profile_pic?: string | null;            // verified
  primary_slug?: string | null;
  slugs?: string[] | null;
  follower_count?: number | null;
  connection_count?: number | null;
  open_to_work?: boolean | null;
  premium?: boolean | null;
  influencer?: boolean | null;
  is_hiring?: boolean | null;
  // Nested current-role object; the fetcher reads title + company_name.
  current_job?: {
    company_name?: string | null;
    title?: string | null;
    linkedin_company_id?: string | null;
    locality?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    is_current?: boolean | null;
    seniority?: string | null;
    job_function?: string | null;
    employment_type?: string | null;
  } | null;
  tags?: string[] | null;
  career_began_at?: string | null;
  organizations?: unknown[] | null;
  websites?: string[] | null;
  languages?: unknown[] | null;
  custom_data?: unknown | null;
  relevance_score?: number | null;
  last_sort_key?: string | null;
  experiences?: FiberExperience[] | null;
  articles?: FiberArticle[] | null;
  tenures?: unknown[] | null;
  detailed_education?: unknown[] | null;
  detailed_work_experiences?: unknown[] | null;
  // ── Optional convenience aliases (may be null) ───────────────────
  email?: string | null;                  // verified present but often null
  fullName?: string | null;               // camelCase alias, may be null
  linkedinUrl?: string | null;            // camelCase alias, may be null
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
  // Shape verification is handled by scripts/probe-fiber-industries.ts
  // (B4d). Run with a live FIBER_API_KEY once per quota refresh cycle to
  // catch API drift (Fiber v1 may rename to `industry` or an enum).
  // fiber-client-shape.test.ts pins the TypeScript contract and fails
  // fast if the string[] declaration is ever flipped. Today the
  // fetcher passes the array through untransformed.
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
