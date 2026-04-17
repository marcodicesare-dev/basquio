import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseCsv } from "csv-parse/sync";

import { loadBasquioScriptEnv } from "./load-app-env";

loadBasquioScriptEnv();

type InputRow = {
  "Full Name": string;
  "First Name": string;
  "Last Name": string;
  Company: string;
  Market: string;
  Email: string;
  Title: string;
  "Functional Area": string;
  "Management Level": string;
  Language: string;
};

type MatchStatus =
  | "same_company"
  | "moved"
  | "multi_current_conflict"
  | "unknown"
  | "not_found";

type EnrichmentSource = "fiber" | "fiber+posts" | "fiber+firecrawl" | "firecrawl" | "not_found";

type FiberChargeInfo = {
  method?: string;
  creditsCharged?: number;
};

type FiberLocation = {
  city?: string | null;
  state_name?: string | null;
  country_code?: string | null;
  country_name?: string | null;
  formatted_address?: string | null;
};

type FiberExperience = {
  is_current?: boolean | null;
  company_name?: string | null;
  locality?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  title?: string | null;
};

type FiberArticle = {
  title?: string | null;
  text?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  date?: string | null;
};

type FiberProfile = {
  first_name?: string | null;
  last_name?: string | null;
  headline?: string | null;
  url?: string | null;
  primary_slug?: string | null;
  entity_urn?: string | null;
  follower_count?: number | null;
  connection_count?: number | null;
  industry_name?: string | null;
  inferred_location?: FiberLocation | null;
  experiences?: FiberExperience[] | null;
  articles?: FiberArticle[] | null;
  current_job?: {
    title?: string | null;
    company_name?: string | null;
    is_current?: boolean | null;
  } | null;
};

type FiberLookupResponse = {
  output?: {
    data?: FiberProfile[] | null;
  } | null;
  chargeInfo?: FiberChargeInfo | null;
};

type FiberPostsResponse = {
  output?: {
    posts?: FiberArticle[] | null;
    data?: FiberArticle[] | null;
  } | null;
  chargeInfo?: FiberChargeInfo | null;
};

type FirecrawlSearchResult = {
  title?: string;
  description?: string;
  url?: string;
};

type FirecrawlSearchResponse = {
  success?: boolean;
  data?: {
    web?: FirecrawlSearchResult[];
  };
  creditsUsed?: number;
  warning?: string | null;
};

type CurrentRoleSummary = {
  primaryCompany: string;
  primaryTitle: string;
  companies: string[];
  matchStatus: MatchStatus;
  stillAtCrmCompany: boolean;
  movedTo: string;
  notes: string[];
};

type EnrichedRow = {
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  company: string;
  market: string;
  title: string;
  functional_area: string;
  management_level: string;
  language: string;
  linkedin_profile_url: string;
  linkedin_headline: string;
  current_title: string;
  current_company: string;
  current_companies: string;
  company_match_status: MatchStatus;
  still_at_crm_company: "true" | "false";
  moved_to: string;
  location_city: string;
  location_country: string;
  industry_name: string;
  company_vertical: string;
  follower_count: string;
  connection_count: string;
  has_recent_activity: "true" | "false";
  recent_activity_count: string;
  recent_activity_latest_at: string;
  signal_score: string;
  signal_reasons: string;
  enrichment_confidence: string;
  enrichment_source: EnrichmentSource;
  fiber_credits_charged: string;
  firecrawl_credits_used: string;
  notes: string;
};

type Checkpoint = {
  generatedAt: string;
  inputPath: string;
  outputDir: string;
  options: CliArgs;
  summary: Summary;
  rows: EnrichedRow[];
};

type Summary = {
  totalInputRows: number;
  processedRows: number;
  foundRows: number;
  firecrawlFallbackRows: number;
  movers: number;
  sameCompany: number;
  multiCurrentConflict: number;
  notFound: number;
  avgSignalScore: number;
  fiberCreditsCharged: number;
  firecrawlCreditsUsed: number;
};

type CliArgs = {
  inputPath: string;
  outputDir: string;
  offset: number;
  limit?: number;
  concurrency: number;
  batchSize: number;
  pauseMs: number;
  flushEvery: number;
  activityLookbackDays: number;
  useFirecrawlFallback: boolean;
  includePosts: boolean;
  postsMinScore: number;
  fiberRequestsPerMinute: number;
  firecrawlRequestsPerMinute: number;
  retryCount: number;
  retryBaseDelayMs: number;
  resume: boolean;
};

const DEFAULT_INPUT_PATH = ".context/italian-icp-contacts-424.csv";
const DEFAULT_OUTPUT_DIR = "output/contact-enrichment";
const FIBER_BASE_URL = process.env.FIBER_BASE_URL ?? "https://api.fiber.ai";
const FIRECRAWL_BASE_URL = process.env.FIRECRAWL_BASE_URL ?? "https://api.firecrawl.dev";
const LINKEDIN_HOST_RE = /linkedin\.com\/in\//i;
const COMPANY_STOP_WORDS = new Set([
  "the",
  "and",
  "group",
  "holding",
  "holdings",
  "company",
  "companies",
  "italy",
  "italia",
  "spa",
  "srl",
  "srl.",
  "inc",
  "inc.",
  "ltd",
  "ltd.",
  "limited",
  "gmbh",
  "ag",
  "bv",
  "llc",
  "plc",
  "co",
  "corp",
  "corporation",
  "international",
]);
const COMPANY_ALIAS_PATTERNS: Array<[RegExp, string]> = [
  [/\brb\b/g, "reckitt"],
  [/reckitt benckiser/g, "reckitt"],
  [/colgate palmolive/g, "colgate palmolive"],
  [/pepsico/g, "pepsi"],
  [/sodastream/g, "sodastream"],
];
const RELEVANT_VERTICAL_KEYWORDS = [
  "consumer goods",
  "consumer",
  "cpg",
  "fmcg",
  "retail",
  "food",
  "beverage",
  "pharma",
  "health",
  "beauty",
  "household",
];
const IRRELEVANT_VERTICAL_KEYWORDS = [
  "software",
  "saas",
  "technology",
  "tech",
  "bank",
  "banking",
  "financial",
  "finance",
  "insurance",
  "consulting",
  "agency",
  "venture capital",
];
const ROLE_KEYWORDS = [
  "analyst",
  "analytics",
  "insight",
  "insights",
  "category",
  "brand",
  "marketing",
  "shopper",
  "consumer",
  "trade marketing",
  "data",
];
const SENIORITY_KEYWORDS = ["director", "vp", "head", "manager", "lead", "senior director"];

function usageAndExit(): never {
  console.error(
    "Usage: pnpm enrich:contacts --input <csv> [--output-dir <dir>] [--limit <n>] [--offset <n>] [--concurrency <n>] [--resume] [--with-posts] [--no-firecrawl-fallback]",
  );
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const options: CliArgs = {
    inputPath: DEFAULT_INPUT_PATH,
    outputDir: DEFAULT_OUTPUT_DIR,
    offset: 0,
    concurrency: 6,
    batchSize: 50,
    pauseMs: 30_000,
    flushEvery: 10,
    activityLookbackDays: 90,
    useFirecrawlFallback: true,
    includePosts: false,
    postsMinScore: 8,
    fiberRequestsPerMinute: 90,
    firecrawlRequestsPerMinute: 30,
    retryCount: 4,
    retryBaseDelayMs: 2_000,
    resume: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--input":
        options.inputPath = argv[++index] ?? usageAndExit();
        break;
      case "--output-dir":
        options.outputDir = argv[++index] ?? usageAndExit();
        break;
      case "--limit":
        options.limit = parsePositiveInt(argv[++index], "--limit");
        break;
      case "--offset":
        options.offset = parseNonNegativeInt(argv[++index], "--offset");
        break;
      case "--concurrency":
        options.concurrency = parsePositiveInt(argv[++index], "--concurrency");
        break;
      case "--batch-size":
        options.batchSize = parsePositiveInt(argv[++index], "--batch-size");
        break;
      case "--pause-ms":
        options.pauseMs = parseNonNegativeInt(argv[++index], "--pause-ms");
        break;
      case "--flush-every":
        options.flushEvery = parsePositiveInt(argv[++index], "--flush-every");
        break;
      case "--activity-lookback-days":
        options.activityLookbackDays = parsePositiveInt(argv[++index], "--activity-lookback-days");
        break;
      case "--posts-min-score":
        options.postsMinScore = parseNonNegativeInt(argv[++index], "--posts-min-score");
        break;
      case "--fiber-rpm":
        options.fiberRequestsPerMinute = parsePositiveInt(argv[++index], "--fiber-rpm");
        break;
      case "--firecrawl-rpm":
        options.firecrawlRequestsPerMinute = parsePositiveInt(argv[++index], "--firecrawl-rpm");
        break;
      case "--retry-count":
        options.retryCount = parseNonNegativeInt(argv[++index], "--retry-count");
        break;
      case "--retry-base-delay-ms":
        options.retryBaseDelayMs = parseNonNegativeInt(argv[++index], "--retry-base-delay-ms");
        break;
      case "--with-posts":
        options.includePosts = true;
        break;
      case "--resume":
        options.resume = true;
        break;
      case "--no-firecrawl-fallback":
        options.useFirecrawlFallback = false;
        break;
      case "--help":
        usageAndExit();
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        usageAndExit();
    }
  }

  return options;
}

function parsePositiveInt(value: string | undefined, flag: string) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, flag: string) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

function getFiberApiKey() {
  const apiKey = process.env.FIBER_API_KEY;
  if (!apiKey) {
    throw new Error("FIBER_API_KEY is required.");
  }
  return apiKey;
}

function getFirecrawlApiKey() {
  return process.env.FIRECRAWL_API_KEY ?? "";
}

async function loadInputRows(inputPath: string): Promise<InputRow[]> {
  const contents = await readFile(inputPath, "utf8");
  return parseCsv(contents, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as InputRow[];
}

function normalizeWhitespace(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function slugToLinkedinUrl(slug: string | null | undefined) {
  const clean = normalizeWhitespace(slug);
  return clean ? `https://www.linkedin.com/in/${clean}` : "";
}

function bestLinkedinUrl(profile: FiberProfile) {
  const direct = normalizeWhitespace(profile.url);
  if (direct) {
    return direct;
  }

  return slugToLinkedinUrl(profile.primary_slug);
}

function normalizeCompany(value: string | null | undefined) {
  let normalized = normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ");

  for (const [pattern, replacement] of COMPANY_ALIAS_PATTERNS) {
    normalized = normalized.replace(pattern, replacement);
  }

  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && !COMPANY_STOP_WORDS.has(token));

  return tokens.join(" ");
}

function companyMatchScore(left: string | null | undefined, right: string | null | undefined) {
  const a = normalizeCompany(left);
  const b = normalizeCompany(right);
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }

  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const denominator = Math.max(aTokens.size, bTokens.size, 1);
  return intersection / denominator;
}

function companyMatches(left: string | null | undefined, right: string | null | undefined) {
  return companyMatchScore(left, right) >= 0.6;
}

function parseDateValue(value: string | null | undefined) {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function dedupe(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean))];
}

function summarizeCurrentRole(profile: FiberProfile, crmCompany: string): CurrentRoleSummary {
  const notes: string[] = [];
  const experiences = [...(profile.experiences ?? [])]
    .filter((experience) => normalizeWhitespace(experience.company_name) || normalizeWhitespace(experience.title))
    .sort((left, right) => parseDateValue(right.start_date) - parseDateValue(left.start_date));
  const currentExperiences = experiences.filter((experience) => Boolean(experience.is_current));

  if (profile.current_job?.company_name || profile.current_job?.title) {
    currentExperiences.unshift({
      is_current: profile.current_job.is_current ?? true,
      company_name: profile.current_job.company_name ?? "",
      title: profile.current_job.title ?? "",
      start_date: null,
      end_date: null,
      locality: null,
    });
  }

  const dedupedCurrentExperiences = currentExperiences.filter((experience, index) => {
    const fingerprint = `${normalizeCompany(experience.company_name)}|${normalizeWhitespace(experience.title)}`;
    return currentExperiences.findIndex((candidate) => {
      const candidateFingerprint = `${normalizeCompany(candidate.company_name)}|${normalizeWhitespace(candidate.title)}`;
      return candidateFingerprint === fingerprint;
    }) === index;
  });

  if (dedupedCurrentExperiences.length === 0) {
    return {
      primaryCompany: "",
      primaryTitle: "",
      companies: [],
      matchStatus: "unknown",
      stillAtCrmCompany: false,
      movedTo: "",
      notes,
    };
  }

  const companies = dedupe(dedupedCurrentExperiences.map((experience) => experience.company_name));
  const primary = dedupedCurrentExperiences[0];
  const primaryCompany = normalizeWhitespace(primary.company_name);
  const primaryTitle = normalizeWhitespace(primary.title);
  const anyCurrentMatch = companies.some((company) => companyMatches(company, crmCompany));
  const primaryMatch = companyMatches(primaryCompany, crmCompany);
  const hasConflictingCurrentCompany = companies.some((company) => !companyMatches(company, crmCompany));

  let matchStatus: MatchStatus = "unknown";
  let movedTo = "";
  if (primaryMatch && hasConflictingCurrentCompany) {
    matchStatus = "multi_current_conflict";
    notes.push("Multiple current companies found; one matches CRM and another does not.");
  } else if (!primaryMatch && anyCurrentMatch) {
    matchStatus = "multi_current_conflict";
    movedTo = primaryCompany;
    notes.push("Primary current company differs from CRM but another current role still matches CRM.");
  } else if (primaryMatch) {
    matchStatus = "same_company";
  } else if (primaryCompany) {
    matchStatus = "moved";
    movedTo = primaryCompany;
  }

  return {
    primaryCompany,
    primaryTitle,
    companies,
    matchStatus,
    stillAtCrmCompany: anyCurrentMatch || primaryMatch,
    movedTo,
    notes,
  };
}

function toVertical(industryName: string, companyName: string) {
  const text = `${normalizeWhitespace(industryName)} ${normalizeWhitespace(companyName)}`.toLowerCase();
  if (!text) {
    return "";
  }
  if (text.includes("consumer goods") || text.includes("fmcg") || text.includes("cpg")) {
    return "CPG / FMCG";
  }
  if (text.includes("retail")) {
    return "Retail";
  }
  if (text.includes("pharma") || text.includes("health")) {
    return "Pharma / Health";
  }
  if (text.includes("food") || text.includes("beverage")) {
    return "Food / Beverage";
  }
  if (text.includes("beauty")) {
    return "Beauty / Personal Care";
  }
  return normalizeWhitespace(industryName);
}

function isRelevantVertical(industryName: string, companyName: string) {
  const haystack = `${industryName} ${companyName}`.toLowerCase();
  return RELEVANT_VERTICAL_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function isIrrelevantVertical(industryName: string, companyName: string) {
  const haystack = `${industryName} ${companyName}`.toLowerCase();
  return IRRELEVANT_VERTICAL_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function computeRecentActivity(articles: FiberArticle[], activityLookbackDays: number) {
  const cutoff = Date.now() - activityLookbackDays * 24 * 60 * 60 * 1000;
  const recentTimestamps = articles
    .map((article) => parseDateValue(article.published_at ?? article.created_at ?? article.date))
    .filter((timestamp) => timestamp >= cutoff);
  const latest = recentTimestamps.length > 0 ? new Date(Math.max(...recentTimestamps)).toISOString() : "";
  return {
    hasRecentActivity: recentTimestamps.length > 0,
    recentActivityCount: recentTimestamps.length,
    recentActivityLatestAt: latest,
  };
}

function containsKeyword(haystack: string, keywords: string[]) {
  const normalizedHaystack = haystack.toLowerCase();
  return keywords.some((keyword) => normalizedHaystack.includes(keyword));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

class ApiError extends Error {
  status: number;
  retryAfterMs: number | null;

  constructor(message: string, status: number, retryAfterMs: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

class RateLimiter {
  private nextAvailableAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly requestsPerMinute: number) {}

  async schedule<T>(operation: () => Promise<T>) {
    const minIntervalMs = Math.ceil(60_000 / Math.max(this.requestsPerMinute, 1));
    const scheduled = this.chain.then(async () => {
      const waitMs = Math.max(0, this.nextAvailableAt - Date.now());
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      this.nextAvailableAt = Math.max(this.nextAvailableAt, Date.now()) + minIntervalMs;
      return operation();
    });
    this.chain = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  }
}

function computeScore(input: {
  source: EnrichmentSource;
  headline: string;
  currentTitle: string;
  originalTitle: string;
  vertical: string;
  currentCompany: string;
  linkedinUrl: string;
  followerCount: number;
  connectionCount: number;
  hasRecentActivity: boolean;
  locationCountry: string;
}) {
  let score = 0;
  const reasons: string[] = [];
  const roleText = `${input.headline} ${input.currentTitle} ${input.originalTitle}`.toLowerCase();

  if (containsKeyword(roleText, ROLE_KEYWORDS)) {
    score += 3;
    reasons.push("role aligns with insights / brand / analytics work");
  }
  if (containsKeyword(roleText, SENIORITY_KEYWORDS)) {
    score += 2;
    reasons.push("seniority indicates decision-maker or workflow owner");
  }
  if (isRelevantVertical(input.vertical, input.currentCompany)) {
    score += 2;
    reasons.push("current company is in a relevant consumer vertical");
  }
  if (input.followerCount >= 500 || input.connectionCount >= 500) {
    score += 1;
    reasons.push("profile shows meaningful network reach");
  }
  if (input.hasRecentActivity) {
    score += 1;
    reasons.push("recent activity detected");
  }
  if (input.locationCountry.toLowerCase() === "italy" || input.locationCountry.toLowerCase() === "ita") {
    score += 1;
    reasons.push("current location appears to be Italy");
  }
  if (isIrrelevantVertical(input.vertical, input.currentCompany)) {
    score -= 2;
    reasons.push("current company looks outside the target vertical");
  }
  if (!input.linkedinUrl) {
    score -= 1;
    reasons.push("profile is not yet outreach-ready because the LinkedIn URL is missing");
  }
  if (!input.currentCompany && !input.currentTitle) {
    score -= 1;
    reasons.push("current role is incomplete");
  }
  if (input.source === "not_found") {
    score -= 3;
    reasons.push("no reliable enrichment source found");
  }

  return {
    score: clamp(score, 0, 10),
    reasons,
  };
}

function computeConfidence(input: {
  source: EnrichmentSource;
  linkedinUrl: string;
  currentCompany: string;
  crmCompany: string;
  locationCountry: string;
  companyMatchStatus: MatchStatus;
}) {
  let confidence = input.source === "fiber" || input.source === "fiber+posts" ? 0.5 : 0.25;
  if (input.source === "fiber+firecrawl") {
    confidence = 0.55;
  }
  if (input.linkedinUrl) {
    confidence += 0.2;
  }
  if (input.currentCompany) {
    confidence += 0.1;
  }
  if (input.companyMatchStatus === "same_company" || input.companyMatchStatus === "moved") {
    confidence += 0.1;
  }
  if (input.locationCountry) {
    confidence += 0.1;
  }
  if (input.source === "not_found") {
    confidence = 0;
  }
  if (companyMatches(input.currentCompany, input.crmCompany)) {
    confidence += 0.05;
  }
  return clamp(confidence, 0, 1);
}

async function postJson<T>(url: string, init: { headers?: Record<string, string>; body: Record<string, unknown> }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(init.body),
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) as T : {} as T;
  if (!response.ok) {
    const message = typeof json === "object" && json && "message" in json
      ? String((json as Record<string, unknown>).message)
      : `${response.status} ${response.statusText}`;
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader
      ? Number.parseFloat(retryAfterHeader) * 1000
      : null;
    throw new ApiError(message, response.status, Number.isFinite(retryAfterMs) ? retryAfterMs : null);
  }

  return json;
}

function isRetryableError(error: unknown) {
  if (error instanceof ApiError) {
    return error.status === 408 || error.status === 409 || error.status === 425 || error.status === 429 || error.status >= 500;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("timed out")
    || message.includes("timeout")
    || message.includes("network")
    || message.includes("fetch failed")
    || message.includes("econnreset")
    || message.includes("socket hang up")
  );
}

function retryDelayMs(error: unknown, attempt: number, baseDelayMs: number) {
  if (error instanceof ApiError && error.retryAfterMs && error.retryAfterMs > 0) {
    return error.retryAfterMs;
  }
  return baseDelayMs * 2 ** attempt;
}

async function withRetries<T>(label: string, args: CliArgs, operation: () => Promise<T>) {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= args.retryCount || !isRetryableError(error)) {
        throw error;
      }
      const delayMs = retryDelayMs(error, attempt, args.retryBaseDelayMs);
      console.warn(`${label} failed on attempt ${attempt + 1}; retrying in ${delayMs}ms.`);
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

async function lookupFiberByEmail(email: string, fiberApiKey: string, args: CliArgs, fiberLimiter: RateLimiter) {
  try {
    const response = await withRetries(`Fiber lookup for ${email}`, args, () =>
      fiberLimiter.schedule(() =>
        postJson<FiberLookupResponse>(`${FIBER_BASE_URL}/v1/email-to-person/single`, {
          body: {
            apiKey: fiberApiKey,
            email,
          },
        }),
      )
    );
    const profiles = response.output?.data ?? [];
    return {
      profile: profiles[0] ?? null,
      chargeInfo: response.chargeInfo ?? null,
      error: "",
    };
  } catch (error) {
    return {
      profile: null,
      chargeInfo: null,
      error: error instanceof Error ? error.message : "Fiber lookup failed.",
    };
  }
}

async function lookupFiberPosts(
  linkedinUrl: string,
  fiberApiKey: string,
  args: CliArgs,
  fiberLimiter: RateLimiter,
) {
  try {
    const response = await withRetries(`Fiber posts for ${linkedinUrl}`, args, () =>
      fiberLimiter.schedule(() =>
        postJson<FiberPostsResponse>(`${FIBER_BASE_URL}/v1/linkedin-live-fetch/profile-posts`, {
          body: {
            apiKey: fiberApiKey,
            linkedinUrl,
          },
        }),
      )
    );
    const posts = response.output?.posts ?? response.output?.data ?? [];
    return {
      posts,
      chargeInfo: response.chargeInfo ?? null,
      error: "",
    };
  } catch (error) {
    return {
      posts: [] as FiberArticle[],
      chargeInfo: null,
      error: error instanceof Error ? error.message : "Fiber posts lookup failed.",
    };
  }
}

async function firecrawlLinkedinFallback(
  row: InputRow,
  firecrawlApiKey: string,
  args: CliArgs,
  firecrawlLimiter: RateLimiter,
) {
  if (!firecrawlApiKey) {
    return {
      linkedinUrl: "",
      headline: "",
      currentCompany: "",
      creditsUsed: 0,
      warning: "FIRECRAWL_API_KEY not configured.",
    };
  }

  try {
    const response = await withRetries(`Firecrawl search for ${row.Email}`, args, () =>
      firecrawlLimiter.schedule(() =>
        postJson<FirecrawlSearchResponse>(`${FIRECRAWL_BASE_URL}/v2/search`, {
          headers: {
            Authorization: `Bearer ${firecrawlApiKey}`,
          },
          body: {
            query: `"${row["First Name"]} ${row["Last Name"]}" "${row.Company}" site:linkedin.com/in/`,
            limit: 5,
            country: row.Market === "Italy" ? "IT" : "US",
            location: row.Market || "Italy",
            sources: [{ type: "web" }],
          },
        }),
      )
    );

    const candidate = (response.data?.web ?? []).find((result) => LINKEDIN_HOST_RE.test(result.url ?? ""));
    return {
      linkedinUrl: normalizeWhitespace(candidate?.url),
      headline: normalizeWhitespace(candidate?.description || candidate?.title),
      currentCompany: "",
      creditsUsed: response.creditsUsed ?? 0,
      warning: normalizeWhitespace(response.warning),
    };
  } catch (error) {
    return {
      linkedinUrl: "",
      headline: "",
      currentCompany: "",
      creditsUsed: 0,
      warning: error instanceof Error ? error.message : "Firecrawl search failed.",
    };
  }
}

function toCsv(rows: EnrichedRow[]) {
  if (rows.length === 0) {
    return "";
  }

  const columns = Object.keys(rows[0]) as Array<keyof EnrichedRow>;
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsv(row[column])).join(","));
  }
  return lines.join("\n");
}

function escapeCsv(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function numericString(value: number | null | undefined) {
  return value == null || Number.isNaN(value) ? "" : String(value);
}

function truthyString(value: boolean) {
  return value ? "true" : "false";
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sortRows(rows: EnrichedRow[]) {
  return [...rows].sort((left, right) => {
    const scoreDiff = Number(right.signal_score) - Number(left.signal_score);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return Number(right.enrichment_confidence) - Number(left.enrichment_confidence);
  });
}

function computeSummary(allInputRows: number, rows: EnrichedRow[]): Summary {
  const signalScores = rows.map((row) => Number(row.signal_score)).filter((value) => Number.isFinite(value));
  return {
    totalInputRows: allInputRows,
    processedRows: rows.length,
    foundRows: rows.filter((row) => row.enrichment_source !== "not_found").length,
    firecrawlFallbackRows: rows.filter((row) => row.enrichment_source === "firecrawl").length,
    movers: rows.filter((row) => row.company_match_status === "moved").length,
    sameCompany: rows.filter((row) => row.company_match_status === "same_company").length,
    multiCurrentConflict: rows.filter((row) => row.company_match_status === "multi_current_conflict").length,
    notFound: rows.filter((row) => row.enrichment_source === "not_found").length,
    avgSignalScore: Number(average(signalScores).toFixed(2)),
    fiberCreditsCharged: rows.reduce((sum, row) => sum + Number(row.fiber_credits_charged || 0), 0),
    firecrawlCreditsUsed: rows.reduce((sum, row) => sum + Number(row.firecrawl_credits_used || 0), 0),
  };
}

async function writeOutputs(
  outputDir: string,
  inputPath: string,
  args: CliArgs,
  allInputRows: number,
  rows: EnrichedRow[],
) {
  const sortedRows = sortRows(rows);
  const movers = sortedRows.filter((row) => row.company_match_status === "moved");
  const summary = computeSummary(allInputRows, rows);
  const checkpoint: Checkpoint = {
    generatedAt: new Date().toISOString(),
    inputPath,
    outputDir,
    options: args,
    summary,
    rows: sortedRows,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "enriched-contacts.csv"), toCsv(sortedRows), "utf8");
  await writeFile(path.join(outputDir, "movers.csv"), toCsv(movers), "utf8");
  await writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await writeFile(path.join(outputDir, "checkpoint.json"), JSON.stringify(checkpoint, null, 2), "utf8");
}

async function loadCheckpoint(outputDir: string) {
  const checkpointPath = path.join(outputDir, "checkpoint.json");
  try {
    const raw = await readFile(checkpointPath, "utf8");
    return JSON.parse(raw) as Checkpoint;
  } catch {
    return null;
  }
}

async function enrichRow(
  row: InputRow,
  args: CliArgs,
  fiberApiKey: string,
  firecrawlApiKey: string,
  fiberLimiter: RateLimiter,
  firecrawlLimiter: RateLimiter,
) {
  const notes: string[] = [];
  let source: EnrichmentSource = "not_found";
  let profile: FiberProfile | null = null;
  let fiberCreditsCharged = 0;
  let firecrawlCreditsUsed = 0;

  const fiberResult = await lookupFiberByEmail(row.Email, fiberApiKey, args, fiberLimiter);
  fiberCreditsCharged += fiberResult.chargeInfo?.creditsCharged ?? 0;
  if (fiberResult.error) {
    notes.push(`Fiber: ${fiberResult.error}`);
  }
  if (fiberResult.profile) {
    profile = fiberResult.profile;
    source = "fiber";
  }

  const currentRole = summarizeCurrentRole(profile ?? {}, row.Company);
  const initialHeadline = normalizeWhitespace(profile?.headline);
  const initialCurrentTitle = currentRole.primaryTitle || normalizeWhitespace(profile?.current_job?.title);
  const initialCurrentCompany = currentRole.primaryCompany || normalizeWhitespace(profile?.current_job?.company_name);
  const location = profile?.inferred_location ?? null;
  const initialVertical = toVertical(normalizeWhitespace(profile?.industry_name), initialCurrentCompany);
  const initialActivity = computeRecentActivity(profile?.articles ?? [], args.activityLookbackDays);
  const initialScore = computeScore({
    source,
    headline: initialHeadline,
    currentTitle: initialCurrentTitle,
    originalTitle: row.Title,
    vertical: initialVertical,
    currentCompany: initialCurrentCompany,
    linkedinUrl: bestLinkedinUrl(profile ?? {}),
    followerCount: profile?.follower_count ?? 0,
    connectionCount: profile?.connection_count ?? 0,
    hasRecentActivity: initialActivity.hasRecentActivity,
    locationCountry: normalizeWhitespace(location?.country_name ?? location?.country_code),
  });

  let activity = initialActivity;
  if (
    args.includePosts &&
    source === "fiber" &&
    !activity.hasRecentActivity &&
    bestLinkedinUrl(profile ?? {}) &&
    initialScore.score >= args.postsMinScore
  ) {
    const postsResult = await lookupFiberPosts(bestLinkedinUrl(profile ?? {}), fiberApiKey, args, fiberLimiter);
    fiberCreditsCharged += postsResult.chargeInfo?.creditsCharged ?? 0;
    if (postsResult.error) {
      notes.push(`Fiber posts: ${postsResult.error}`);
    }
    if (postsResult.posts.length > 0) {
      const mergedArticles = [...(profile?.articles ?? []), ...postsResult.posts];
      activity = computeRecentActivity(mergedArticles, args.activityLookbackDays);
      source = "fiber+posts";
    }
  }

  let fallbackLinkedinUrl = "";
  let fallbackHeadline = "";
  if ((!profile || !bestLinkedinUrl(profile)) && args.useFirecrawlFallback) {
    const fallback = await firecrawlLinkedinFallback(row, firecrawlApiKey, args, firecrawlLimiter);
    fallbackLinkedinUrl = fallback.linkedinUrl;
    fallbackHeadline = fallback.headline;
    firecrawlCreditsUsed += fallback.creditsUsed;
    if (fallback.warning) {
      notes.push(`Firecrawl: ${fallback.warning}`);
    }
    if (fallbackLinkedinUrl) {
      source = profile ? "fiber+firecrawl" : "firecrawl";
      if (profile) {
        notes.push("Firecrawl supplied a fallback LinkedIn URL candidate.");
      }
    }
  }

  const linkedinUrl = bestLinkedinUrl(profile ?? {}) || fallbackLinkedinUrl;
  const currentCompany = initialCurrentCompany;
  const companyMatchStatus = profile ? currentRole.matchStatus : source === "firecrawl" ? "unknown" : "not_found";
  const stillAtCrmCompany = profile ? currentRole.stillAtCrmCompany : false;
  const vertical = initialVertical;
  const headline = initialHeadline || fallbackHeadline;
  const score = computeScore({
    source,
    headline,
    currentTitle: initialCurrentTitle,
    originalTitle: row.Title,
    vertical,
    currentCompany,
    linkedinUrl,
    followerCount: profile?.follower_count ?? 0,
    connectionCount: profile?.connection_count ?? 0,
    hasRecentActivity: activity.hasRecentActivity,
    locationCountry: normalizeWhitespace(location?.country_name ?? location?.country_code),
  });
  const confidence = computeConfidence({
    source,
    linkedinUrl,
    currentCompany,
    crmCompany: row.Company,
    locationCountry: normalizeWhitespace(location?.country_name ?? location?.country_code),
    companyMatchStatus,
  });

  if (currentRole.notes.length > 0) {
    notes.push(...currentRole.notes);
  }
  if (!linkedinUrl) {
    notes.push("No LinkedIn URL resolved.");
  }

  return {
    full_name: row["Full Name"],
    first_name: row["First Name"],
    last_name: row["Last Name"],
    email: row.Email,
    company: row.Company,
    market: row.Market,
    title: row.Title,
    functional_area: row["Functional Area"],
    management_level: row["Management Level"],
    language: row.Language,
    linkedin_profile_url: linkedinUrl,
    linkedin_headline: headline,
    current_title: initialCurrentTitle,
    current_company: currentCompany,
    current_companies: currentRole.companies.join(" | "),
    company_match_status: companyMatchStatus,
    still_at_crm_company: truthyString(stillAtCrmCompany),
    moved_to: currentRole.movedTo,
    location_city: normalizeWhitespace(location?.city),
    location_country: normalizeWhitespace(location?.country_name ?? location?.country_code),
    industry_name: normalizeWhitespace(profile?.industry_name),
    company_vertical: vertical,
    follower_count: numericString(profile?.follower_count),
    connection_count: numericString(profile?.connection_count),
    has_recent_activity: truthyString(activity.hasRecentActivity),
    recent_activity_count: String(activity.recentActivityCount),
    recent_activity_latest_at: activity.recentActivityLatestAt,
    signal_score: String(score.score),
    signal_reasons: score.reasons.join("; "),
    enrichment_confidence: confidence.toFixed(2),
    enrichment_source: source,
    fiber_credits_charged: String(fiberCreditsCharged),
    firecrawl_credits_used: String(firecrawlCreditsUsed),
    notes: notes.join(" | "),
  } satisfies EnrichedRow;
}

async function sleep(ms: number) {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWorkers<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      await worker(items[index] as T, index);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputRows = await loadInputRows(args.inputPath);
  const selectedRows = inputRows.slice(args.offset, args.limit ? args.offset + args.limit : undefined);

  if (selectedRows.length === 0) {
    throw new Error("No rows selected.");
  }

  const fiberApiKey = getFiberApiKey();
  const firecrawlApiKey = getFirecrawlApiKey();
  const fiberLimiter = new RateLimiter(args.fiberRequestsPerMinute);
  const firecrawlLimiter = new RateLimiter(args.firecrawlRequestsPerMinute);
  const checkpoint = args.resume ? await loadCheckpoint(args.outputDir) : null;
  const existingByEmail = new Map(
    (checkpoint?.rows ?? []).map((row) => [row.email.toLowerCase(), row]),
  );
  const enrichedRows = new Map(existingByEmail);
  const pendingRows = selectedRows.filter((row) => !enrichedRows.has(row.Email.toLowerCase()));

  console.log(
    `Enriching ${selectedRows.length} contacts from ${path.relative(process.cwd(), args.inputPath)} into ${path.relative(process.cwd(), args.outputDir)} with concurrency=${args.concurrency}, fiberRpm=${args.fiberRequestsPerMinute}, firecrawlRpm=${args.firecrawlRequestsPerMinute}`,
  );

  if (pendingRows.length === 0) {
    console.log("No pending rows after resume checkpoint.");
    const summary = computeSummary(inputRows.length, [...enrichedRows.values()]);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  let processedInThisRun = 0;
  let flushChain: Promise<void> = Promise.resolve();
  const enqueueFlush = (force = false) => {
    if (!force && processedInThisRun % args.flushEvery !== 0 && processedInThisRun !== pendingRows.length) {
      return;
    }
    flushChain = flushChain.then(async () => {
      await writeOutputs(args.outputDir, args.inputPath, args, inputRows.length, [...enrichedRows.values()]);
      const allRows = [...enrichedRows.values()];
      console.log(
        `Processed ${processedInThisRun}/${pendingRows.length} pending rows in this run. Current source mix: fiber=${allRows.filter((entry) => entry.enrichment_source === "fiber" || entry.enrichment_source === "fiber+posts" || entry.enrichment_source === "fiber+firecrawl").length}, firecrawl=${allRows.filter((entry) => entry.enrichment_source === "firecrawl").length}, not_found=${allRows.filter((entry) => entry.enrichment_source === "not_found").length}`,
      );
    });
  };

  await runWorkers(pendingRows, args.concurrency, async (row) => {
    const enriched = await enrichRow(row, args, fiberApiKey, firecrawlApiKey, fiberLimiter, firecrawlLimiter);
    enrichedRows.set(row.Email.toLowerCase(), enriched);
    processedInThisRun += 1;
    enqueueFlush();
  });

  enqueueFlush(true);
  await flushChain;
  await writeOutputs(args.outputDir, args.inputPath, args, inputRows.length, [...enrichedRows.values()]);
  const summary = computeSummary(inputRows.length, [...enrichedRows.values()]);
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
