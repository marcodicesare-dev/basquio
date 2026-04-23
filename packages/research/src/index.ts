/**
 * Research package barrel.
 *
 * Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md §5.1.
 * Day 2 ships the HTTP helpers plus the two external-intelligence
 * clients. Day 3 adds the planner. Day 4 adds the fetcher with dual-write
 * into knowledge_documents plus the EvidenceRef adapter. Day 5 wires the
 * `research` phase into `generate-deck.ts`.
 *
 * Consumers should import from this entrypoint unless they need a
 * specific submodule (e.g. `@basquio/research/firecrawl` or
 * `@basquio/research/fiber`).
 */

export {
  ApiError,
  DEFAULT_RETRY_OPTIONS,
  RateLimiter,
  getJson,
  isRetryableError,
  postJson,
  retryDelayMs,
  sleep,
  withRetries,
} from "./http";
export type { PostJsonInit, RetryOptions } from "./http";

export { createFirecrawlClient } from "./firecrawl-client";
export type {
  FirecrawlBatchScrapeKickoff,
  FirecrawlBatchScrapeRequest,
  FirecrawlBatchScrapeStatus,
  FirecrawlClient,
  FirecrawlClientOptions,
  FirecrawlCrawlKickoff,
  FirecrawlCrawlRequest,
  FirecrawlCrawlStatus,
  FirecrawlFormat,
  FirecrawlLocation,
  FirecrawlMapLink,
  FirecrawlMapRequest,
  FirecrawlMapResponse,
  FirecrawlProxyMode,
  FirecrawlScrapeData,
  FirecrawlScrapeOptions,
  FirecrawlScrapeRequest,
  FirecrawlScrapeResponse,
  FirecrawlSearchRequest,
  FirecrawlSearchResponse,
  FirecrawlSearchResult,
} from "./firecrawl-client";

export { createFiberClient } from "./fiber-client";
export type {
  FiberArticle,
  FiberChargeInfo,
  FiberClient,
  FiberClientOptions,
  FiberExperience,
  FiberLocation,
  FiberLookupResponse,
  FiberPeopleSearchQuery,
  FiberPeopleSearchResponse,
  FiberPostsResponse,
  FiberProfile,
} from "./fiber-client";

export { createResearchPlan } from "./planner";
export type { PlannerDeps } from "./planner";

export {
  PLANNER_SYSTEM_PROMPT,
  buildPlannerUserMessage,
  defaultFreshnessWindowForIntent,
} from "./planner-prompt";

export {
  DEFAULT_PLANNER_TUNING,
  evidenceRefSchema,
  haikuPlanOutputSchema,
  researchPlanSchema,
  researchQuerySchema,
  researchQueryIntentSchema,
  researchQueryGapReasonSchema,
  sourceCatalogEntrySchema,
} from "./types";
export type {
  EvidenceRef,
  GraphCoverageHit,
  GraphCoverageResult,
  GraphQueryFn,
  HaikuCallFn,
  HaikuPlanOutput,
  PlannerInput,
  PlannerTuning,
  ResearchBudget,
  ResearchPlan,
  ResearchQuery,
  ResearchQueryGapReason,
  ResearchQueryIntent,
  SourceCatalogEntry,
} from "./types";
