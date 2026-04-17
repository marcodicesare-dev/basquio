import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseCsv } from "csv-parse/sync";
import * as XLSX from "xlsx";

import { loadBasquioScriptEnv } from "./load-app-env";

loadBasquioScriptEnv();

type WorkbookContact = {
  source_key: string;
  full_name: string;
  first_name: string;
  last_name: string;
  company: string;
  email: string;
  phone: string;
  country: string;
  title: string;
  contact_owner: string;
  contact_tags: string;
  functional_area: string;
};

type MatchStatus =
  | "same_company"
  | "moved"
  | "multi_current_conflict"
  | "unknown"
  | "not_found";

type EnrichmentSource = "fiber" | "merged_v5" | "not_found";
type EnrichmentTier = "tier1_icp" | "tier2_director" | "merged_v5";

type FiberLocation = {
  city?: string | null;
  country_name?: string | null;
  country_code?: string | null;
};

type FiberExperience = {
  is_current?: boolean | null;
  company_name?: string | null;
  title?: string | null;
  start_date?: string | null;
};

type FiberProfile = {
  url?: string | null;
  primary_slug?: string | null;
  headline?: string | null;
  follower_count?: number | null;
  connection_count?: number | null;
  industry_name?: string | null;
  inferred_location?: FiberLocation | null;
  experiences?: FiberExperience[] | null;
  current_job?: {
    company_name?: string | null;
    title?: string | null;
    is_current?: boolean | null;
  } | null;
};

type FiberLookupResponse = {
  output?: {
    data?: FiberProfile[] | null;
  } | null;
  chargeInfo?: {
    creditsCharged?: number | null;
  } | null;
};

type OutputRow = Record<string, string>;

type CheckpointRow = {
  key: string;
  row: OutputRow;
};

type Checkpoint = {
  generatedAt: string;
  inputPath: string;
  v5Path: string;
  outputDir: string;
  options: CliArgs;
  stats: Summary;
  processedKeys: string[];
  rows: CheckpointRow[];
};

type Summary = {
  workbookRows: number;
  selectedRows: number;
  tier1Rows: number;
  tier2Rows: number;
  skippedRows: number;
  mergedFromV5: number;
  processedRows: number;
  fiberLookups: number;
  foundRows: number;
  notFoundRows: number;
  movers: number;
  sameCompany: number;
  multiCurrentConflict: number;
  fiberCreditsCharged: number;
  errors: number;
};

type CliArgs = {
  inputPath: string;
  v5Path: string;
  outputDir: string;
  sheetName?: string;
  concurrency: number;
  fiberRequestsPerMinute: number;
  flushEvery: number;
  retryCount: number;
  retryBaseDelayMs: number;
  resume: boolean;
  limit?: number;
};

type TierSelection = {
  tier: EnrichmentTier | "skipped";
  reason: string;
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

const DEFAULT_INPUT_PATH = "/tmp/attachments/Active Contacts ITA with Roles-v1.xlsx";
const DEFAULT_V5_PATH = "output/contact-enrichment/enriched-contacts-v5.csv";
const DEFAULT_OUTPUT_DIR = "output/contact-enrichment-fra";
const FIBER_BASE_URL = process.env.FIBER_BASE_URL ?? "https://api.fiber.ai";

const OUTPUT_COLUMNS = [
  "full_name",
  "first_name",
  "last_name",
  "email",
  "company",
  "country",
  "title",
  "functional_area",
  "contact_owner",
  "contact_tags",
  "phone",
  "linkedin_profile_url",
  "linkedin_headline",
  "current_title",
  "current_company",
  "current_companies",
  "company_match_status",
  "still_at_crm_company",
  "moved_to",
  "location_city",
  "location_country",
  "industry_name",
  "company_vertical",
  "follower_count",
  "connection_count",
  "has_recent_activity",
  "recent_activity_count",
  "recent_activity_latest_at",
  "signal_score",
  "signal_reasons",
  "enrichment_confidence",
  "enrichment_source",
  "enrichment_tier",
  "fiber_credits_charged",
  "firecrawl_credits_used",
  "notes",
  "post_count_90d",
  "latest_post_date",
  "latest_post_text",
  "avg_engagement",
  "post_topics",
  "is_active_poster",
  "email_verdict",
  "email_deliverability_score",
  "email_is_catch_all",
  "company_hiring_signal",
  "company_open_analyst_roles",
  "company_open_brand_roles",
  "current_role_start_date",
  "recent_job_change",
  "tenure_months",
  "signal_score_v2",
  "signal_reasons_v2",
] as const;

const TIER1_FUNCTIONAL_AREAS = new Set([
  "analytics / insights",
  "data science",
  "marketing / brand management",
]);

const SENIORITY_KEYWORDS = ["director", "head of", "head", "vp", "chief", "manager", "responsabile"];
const ROLE_KEYWORDS = ["analyst", "analytics", "insight", "insights", "category", "brand", "marketing", "shopper", "consumer", "trade marketing", "data"];
const RELEVANT_VERTICAL_KEYWORDS = ["consumer goods", "consumer", "cpg", "fmcg", "retail", "food", "beverage", "pharma", "health", "beauty", "household"];
const IRRELEVANT_VERTICAL_KEYWORDS = ["software", "saas", "technology", "tech", "bank", "banking", "financial", "finance", "insurance", "consulting", "agency", "venture capital"];

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
  "foods",
  "foods.",
  "beverages",
  "beverage",
  "snack",
]);

const COMPANY_ALIAS_PATTERNS: Array<[RegExp, string]> = [
  [/\brb\b/g, "reckitt"],
  [/reckitt benckiser/g, "reckitt"],
  [/colgate palmolive/g, "colgate palmolive"],
  [/pepsico/g, "pepsico"],
  [/pepsi beverages snack foods/g, "pepsico"],
  [/ferrero intercandy/g, "ferrero"],
  [/intercandy/g, "ferrero"],
  [/unilever hpce foods/g, "unilever"],
  [/sodastream/g, "sodastream"],
];

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

class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill = Date.now();
  private readonly refillRate: number;
  private chain: Promise<void> = Promise.resolve();

  constructor(requestsPerMinute: number) {
    this.tokens = requestsPerMinute;
    this.refillRate = requestsPerMinute / 60_000;
  }

  async acquire() {
    while (true) {
      const waitMs = await this.reserve();
      if (waitMs <= 0) {
        return;
      }
      await sleep(waitMs);
    }
  }

  private reserve() {
    const reservation = this.chain.then(() => {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return 0;
      }
      const missingTokens = 1 - this.tokens;
      return Math.max(Math.ceil(missingTokens / this.refillRate), 100);
    });
    this.chain = reservation.then(() => undefined, () => undefined);
    return reservation;
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) {
      return;
    }
    this.tokens = Math.min(this.tokens + elapsed * this.refillRate, Math.ceil(60_000 * this.refillRate));
    this.lastRefill = now;
  }
}

function usageAndExit(): never {
  console.error("Usage: pnpm enrich:fra-contacts --input <xlsx> [--v5 <csv>] [--output <dir>] [--concurrency <n>] [--rate-limit <rpm>] [--resume]");
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const options: CliArgs = {
    inputPath: DEFAULT_INPUT_PATH,
    v5Path: DEFAULT_V5_PATH,
    outputDir: DEFAULT_OUTPUT_DIR,
    concurrency: 15,
    fiberRequestsPerMinute: 100,
    flushEvery: 50,
    retryCount: 3,
    retryBaseDelayMs: 2_000,
    resume: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--input":
        options.inputPath = argv[++index] ?? usageAndExit();
        break;
      case "--v5":
        options.v5Path = argv[++index] ?? usageAndExit();
        break;
      case "--output":
      case "--output-dir":
        options.outputDir = argv[++index] ?? usageAndExit();
        break;
      case "--sheet":
        options.sheetName = argv[++index] ?? usageAndExit();
        break;
      case "--concurrency":
        options.concurrency = parsePositiveInt(argv[++index], "--concurrency");
        break;
      case "--rate-limit":
      case "--fiber-rpm":
        options.fiberRequestsPerMinute = parsePositiveInt(argv[++index], "--rate-limit");
        break;
      case "--checkpoint-every":
      case "--flush-every":
        options.flushEvery = parsePositiveInt(argv[++index], "--checkpoint-every");
        break;
      case "--retry-count":
        options.retryCount = parseNonNegativeInt(argv[++index], "--retry-count");
        break;
      case "--retry-base-delay-ms":
        options.retryBaseDelayMs = parseNonNegativeInt(argv[++index], "--retry-base-delay-ms");
        break;
      case "--limit":
        options.limit = parsePositiveInt(argv[++index], "--limit");
        break;
      case "--resume":
        options.resume = true;
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

async function sleep(ms: number) {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhitespace(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeText(value: string | null | undefined) {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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
    .filter((token) => token && !COMPANY_STOP_WORDS.has(token));

  return tokens.join(" ");
}

function companyTokens(value: string | null | undefined) {
  return normalizeCompany(value).split(/\s+/).filter((token) => token.length > 2);
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
  return intersection / Math.max(aTokens.size, bTokens.size, 1);
}

function companyMatches(left: string | null | undefined, right: string | null | undefined) {
  return companyMatchScore(left, right) >= 0.6;
}

function containsKeyword(haystack: string, keywords: string[]) {
  return keywords.some((keyword) => haystack.includes(keyword));
}

function isRelevantVertical(text: string) {
  return RELEVANT_VERTICAL_KEYWORDS.some((keyword) => text.includes(keyword));
}

function isIrrelevantVertical(text: string) {
  return IRRELEVANT_VERTICAL_KEYWORDS.some((keyword) => text.includes(keyword));
}

function parseBoolean(value: string | null | undefined) {
  return String(value).toLowerCase() === "true";
}

function parseNumber(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function parseDateValue(value: string | null | undefined) {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function monthsBetween(dateIso: string | null | undefined) {
  if (!dateIso) {
    return "";
  }
  const start = new Date(dateIso);
  if (Number.isNaN(start.getTime())) {
    return "";
  }
  const now = new Date();
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  return String(Math.max(months, 0));
}

function withinLastMonths(dateIso: string | null | undefined, months: number) {
  if (!dateIso) {
    return false;
  }
  const start = new Date(dateIso);
  if (Number.isNaN(start.getTime())) {
    return false;
  }
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return start >= cutoff;
}

function inferVertical(industryName: string, currentCompany: string) {
  const text = normalizeText(`${industryName} ${currentCompany}`);
  if (isRelevantVertical(text)) {
    return "CPG / FMCG";
  }
  if (isIrrelevantVertical(text)) {
    return "Outside target vertical";
  }
  return normalizeWhitespace(industryName);
}

function toLinkedinUrl(input: string | null | undefined) {
  const value = normalizeWhitespace(input);
  if (!value) {
    return "";
  }
  if (!value.includes("linkedin.com")) {
    return `https://www.linkedin.com/in/${value.replace(/^\/+|\/+$/g, "")}`;
  }
  const match = value.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? `https://www.linkedin.com/in/${match[1]}` : value;
}

function bestLinkedinUrl(profile: FiberProfile) {
  return toLinkedinUrl(profile.url) || toLinkedinUrl(profile.primary_slug);
}

function createEmptyOutputRow() {
  const row: OutputRow = {};
  for (const column of OUTPUT_COLUMNS) {
    row[column] = "";
  }
  row.has_recent_activity = "false";
  row.recent_activity_count = "0";
  row.is_active_poster = "false";
  row.still_at_crm_company = "false";
  row.firecrawl_credits_used = "0";
  row.fiber_credits_charged = "0";
  row.recent_job_change = "false";
  return row;
}

function classifyTier(contact: WorkbookContact): TierSelection {
  const functionalArea = normalizeText(contact.functional_area);
  const title = normalizeText(contact.title);
  const tags = normalizeText(contact.contact_tags);

  if (TIER1_FUNCTIONAL_AREAS.has(functionalArea) && containsKeyword(title, SENIORITY_KEYWORDS)) {
    return { tier: "tier1_icp", reason: "functional area matches ICP and title is senior" };
  }

  if (tags.includes("director")) {
    return { tier: "tier2_director", reason: "contact tags include director" };
  }

  return { tier: "skipped", reason: "outside tier 1 and tier 2 filters" };
}

function summarizeCurrentRole(profile: FiberProfile, crmCompany: string): CurrentRoleSummary {
  const notes: string[] = [];
  const currentExperiences = [...(profile.experiences ?? [])]
    .filter((item) => Boolean(item.is_current) && (normalizeWhitespace(item.company_name) || normalizeWhitespace(item.title)))
    .sort((left, right) => parseDateValue(right.start_date) - parseDateValue(left.start_date));

  if (profile.current_job?.company_name || profile.current_job?.title) {
    currentExperiences.unshift({
      is_current: profile.current_job.is_current ?? true,
      company_name: profile.current_job.company_name ?? "",
      title: profile.current_job.title ?? "",
      start_date: "",
    });
  }

  const deduped = currentExperiences.filter((experience, index) => {
    const fingerprint = `${normalizeCompany(experience.company_name)}|${normalizeText(experience.title)}`;
    return currentExperiences.findIndex((candidate) => `${normalizeCompany(candidate.company_name)}|${normalizeText(candidate.title)}` === fingerprint) === index;
  });

  if (deduped.length === 0) {
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

  const companies = deduped.map((experience) => normalizeWhitespace(experience.company_name)).filter(Boolean);
  const matchingCompanies = companies.filter((company) => companyMatches(company, crmCompany));
  const stillAtCrmCompany = matchingCompanies.length > 0;
  const primary = deduped[0];
  const primaryCompany = normalizeWhitespace(primary.company_name);
  const primaryTitle = normalizeWhitespace(primary.title);

  if (deduped.length > 1) {
    notes.push(`Multiple current experiences found: ${companies.join(" | ")}`);
  }

  let matchStatus: MatchStatus = "unknown";
  let movedTo = "";
  if (deduped.length > 1 && matchingCompanies.length > 0 && companies.some((company) => !companyMatches(company, crmCompany))) {
    matchStatus = "multi_current_conflict";
  } else if (stillAtCrmCompany) {
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
    stillAtCrmCompany,
    movedTo,
    notes,
  };
}

function computeConfidence(row: OutputRow) {
  let confidence = row.enrichment_source === "fiber" ? 0.6 : row.enrichment_source === "merged_v5" ? 0.95 : 0;
  if (row.linkedin_profile_url) {
    confidence += 0.15;
  }
  if (row.current_company) {
    confidence += 0.1;
  }
  if (row.company_match_status === "same_company" || row.company_match_status === "moved") {
    confidence += 0.1;
  }
  if (row.location_country) {
    confidence += 0.05;
  }
  return clamp(confidence, 0, 1).toFixed(2);
}

function computeScore(row: OutputRow) {
  let score = 0;
  const reasons: string[] = [];
  const roleText = normalizeText(`${row.linkedin_headline} ${row.current_title} ${row.title}`);
  const verticalText = normalizeText(`${row.company_vertical} ${row.current_company}`);
  const tags = normalizeText(row.contact_tags);
  const topics = normalizeText(row.post_topics);

  if (containsKeyword(roleText, ROLE_KEYWORDS)) {
    score += 3;
    reasons.push("role aligns with insights / brand / analytics work");
  }
  if (containsKeyword(roleText, SENIORITY_KEYWORDS)) {
    score += 2;
    reasons.push("seniority indicates decision-maker or workflow owner");
  }
  if (isRelevantVertical(verticalText)) {
    score += 2;
    reasons.push("current company is in a relevant consumer vertical");
  }
  if (parseBoolean(row.is_active_poster) && (topics.includes("data/analytics/insights") || topics.includes("data") || topics.includes("analytics") || topics.includes("insight"))) {
    score += 2;
    reasons.push("active poster on relevant topics");
  } else if (parseBoolean(row.is_active_poster)) {
    score += 1;
    reasons.push("active poster");
  }
  if (parseNumber(row.avg_engagement) >= 20) {
    score += 1;
    reasons.push("high post engagement");
  }
  if (parseNumber(row.follower_count) >= 500 || parseNumber(row.connection_count) >= 500) {
    score += 1;
    reasons.push("profile shows meaningful network reach");
  }
  if (normalizeText(row.location_country).includes("italy") || normalizeText(row.location_country) === "ita") {
    score += 1;
    reasons.push("current location appears to be Italy");
  }
  if (normalizeText(row.company_hiring_signal) === "active") {
    score += 1;
    reasons.push("company is actively hiring relevant roles");
  }
  if (parseBoolean(row.recent_job_change)) {
    score += 1;
    reasons.push("recent job change");
  }
  if (tags.includes("director")) {
    score += 1;
    reasons.push("contact tags include director");
  }
  if (tags.includes("advisorycouncil")) {
    score += 1;
    reasons.push("contact tags include advisory council");
  }
  if (isIrrelevantVertical(verticalText)) {
    score -= 2;
    reasons.push("current company looks outside the target vertical");
  }
  if (!row.linkedin_profile_url) {
    score -= 1;
    reasons.push("no LinkedIn URL");
  }
  if (["invalid", "risky", "undeliverable"].includes(normalizeText(row.email_verdict))) {
    score -= 1;
    reasons.push("email looks stale");
  }
  if (!row.current_company && !row.current_title) {
    score -= 1;
    reasons.push("no current role data");
  }
  if (row.enrichment_source === "not_found") {
    score -= 3;
    reasons.push("profile not found in primary enrichment");
  }

  const finalScore = String(clamp(score, 0, 10));
  const finalReasons = reasons.join("; ");
  row.signal_score = finalScore;
  row.signal_reasons = finalReasons;
  row.signal_score_v2 = finalScore;
  row.signal_reasons_v2 = finalReasons;
}

async function postJson<T>(url: string, body: Record<string, unknown>, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) as T : {} as T;
    if (!response.ok) {
      const message = typeof json === "object" && json && "message" in json
        ? String((json as Record<string, unknown>).message)
        : `${response.status} ${response.statusText}`;
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? Number.parseFloat(retryAfterHeader) * 1000 : null;
      throw new ApiError(message, response.status, Number.isFinite(retryAfterMs) ? retryAfterMs : null);
    }

    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableError(error: unknown) {
  if (error instanceof ApiError) {
    return error.status === 408 || error.status === 409 || error.status === 425 || error.status === 429 || error.status >= 500;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("timeout") || message.includes("timed out") || message.includes("network") || message.includes("fetch failed") || message.includes("abort");
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

async function lookupFiberByEmail(email: string, fiberApiKey: string, args: CliArgs, limiter: TokenBucketRateLimiter) {
  return withRetries(`Fiber lookup for ${email}`, args, () =>
    limiter.acquire().then(() =>
    postJson<FiberLookupResponse>(`${FIBER_BASE_URL}/v1/email-to-person/single`, {
      apiKey: fiberApiKey,
      email,
    }),
    )
  );
}

function escapeCsv(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function toCsv(rows: OutputRow[]) {
  const lines = [OUTPUT_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(OUTPUT_COLUMNS.map((column) => escapeCsv(row[column] ?? "")).join(","));
  }
  return lines.join("\n");
}

function sortRows(rows: OutputRow[]) {
  return [...rows].sort((left, right) => {
    const scoreDiff = Number(right.signal_score_v2 || 0) - Number(left.signal_score_v2 || 0);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return Number(right.enrichment_confidence || 0) - Number(left.enrichment_confidence || 0);
  });
}

function computeSummary(workbookRows: number, selectedRows: number, tier1Rows: number, tier2Rows: number, rows: OutputRow[]) {
  const isNotFoundRow = (row: OutputRow) => normalizeText(row.enrichment_source).startsWith("not_found");
  return {
    workbookRows,
    selectedRows,
    tier1Rows,
    tier2Rows,
    skippedRows: Math.max(workbookRows - selectedRows, 0),
    mergedFromV5: rows.filter((row) => row.enrichment_tier === "merged_v5").length,
    processedRows: rows.length,
    fiberLookups: rows.filter((row) => row.enrichment_tier !== "merged_v5").length,
    foundRows: rows.filter((row) => !isNotFoundRow(row)).length,
    notFoundRows: rows.filter(isNotFoundRow).length,
    movers: rows.filter((row) => row.company_match_status === "moved").length,
    sameCompany: rows.filter((row) => row.company_match_status === "same_company").length,
    multiCurrentConflict: rows.filter((row) => row.company_match_status === "multi_current_conflict").length,
    fiberCreditsCharged: rows.reduce((sum, row) => sum + Number(row.fiber_credits_charged || 0), 0),
    errors: rows.filter((row) => normalizeText(row.notes).includes("error")).length,
  } satisfies Summary;
}

async function writeOutputs(
  outputDir: string,
  inputPath: string,
  v5Path: string,
  args: CliArgs,
  workbookRows: number,
  selectedRows: number,
  tier1Rows: number,
  tier2Rows: number,
  items: Map<string, OutputRow>,
  processedKeys: Set<string>,
) {
  const rows = sortRows([...items.values()]);
  const movers = rows.filter((row) => row.company_match_status === "moved");
  const summary = computeSummary(workbookRows, selectedRows, tier1Rows, tier2Rows, rows);
  const checkpoint: Checkpoint = {
    generatedAt: new Date().toISOString(),
    inputPath,
    v5Path,
    outputDir,
    options: args,
    stats: summary,
    processedKeys: [...processedKeys],
    rows: [...items.entries()].map(([key, row]) => ({ key, row })),
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "enriched-fra-contacts.csv"), toCsv(rows), "utf8");
  await writeFile(path.join(outputDir, "movers-fra.csv"), toCsv(movers), "utf8");
  await writeFile(path.join(outputDir, "summary-fra.json"), JSON.stringify(summary, null, 2), "utf8");
  await writeFile(path.join(outputDir, "checkpoint-fra.json"), JSON.stringify(checkpoint, null, 2), "utf8");
}

async function loadCheckpoint(outputDir: string) {
  try {
    return JSON.parse(await readFile(path.join(outputDir, "checkpoint-fra.json"), "utf8")) as Checkpoint;
  } catch {
    return null;
  }
}

async function loadWorkbookContacts(inputPath: string, sheetName?: string) {
  const workbook = XLSX.readFile(inputPath, { cellDates: false });
  const activeSheetName = sheetName || workbook.SheetNames[0];
  const sheet = workbook.Sheets[activeSheetName];
  if (!sheet) {
    throw new Error(`Sheet not found: ${activeSheetName}`);
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return rows.map((row, index) => {
    const firstName = normalizeWhitespace(String(row["First Name"] ?? ""));
    const lastName = normalizeWhitespace(String(row["Last Name"] ?? ""));
    const fullName = normalizeWhitespace(String(row[" Full Name"] ?? row["Full Name"] ?? `${firstName} ${lastName}`));
    const email = normalizeWhitespace(String(row.Email ?? "")).toLowerCase();
    const company = normalizeWhitespace(String(row["Account Name"] ?? ""));
    const title = normalizeWhitespace(String(row.Title ?? ""));
    return {
      source_key: `${email || `row-${index + 1}`}:${index + 1}`,
      full_name: fullName,
      first_name: firstName,
      last_name: lastName,
      company,
      email,
      phone: normalizeWhitespace(String(row.Phone ?? "")),
      country: normalizeWhitespace(String(row.Country ?? "")),
      title,
      contact_owner: normalizeWhitespace(String(row["Contact Owner"] ?? "")),
      contact_tags: normalizeWhitespace(String(row["Contact Tags"] ?? "")),
      functional_area: normalizeWhitespace(String(row["Functional Area"] ?? "")),
    } satisfies WorkbookContact;
  });
}

async function loadV5ByEmail(v5Path: string) {
  const contents = await readFile(v5Path, "utf8");
  const rows = parseCsv(contents, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;
  return new Map(rows.map((row) => [normalizeText(row.email), row]));
}

function buildMergedRow(contact: WorkbookContact, existing: Record<string, string>) {
  const row = createEmptyOutputRow();
  for (const column of OUTPUT_COLUMNS) {
    row[column] = normalizeWhitespace(existing[column] ?? row[column]);
  }
  row.full_name = contact.full_name;
  row.first_name = contact.first_name;
  row.last_name = contact.last_name;
  row.email = contact.email;
  row.company = contact.company;
  row.country = contact.country;
  row.title = contact.title;
  row.functional_area = contact.functional_area;
  row.contact_owner = contact.contact_owner;
  row.contact_tags = contact.contact_tags;
  row.phone = contact.phone;
  row.enrichment_source = normalizeWhitespace(existing.enrichment_source) || "merged_v5";
  row.enrichment_tier = "merged_v5";
  row.linkedin_profile_url = toLinkedinUrl(existing.linkedin_profile_url);
  row.enrichment_confidence = computeConfidence({
    ...row,
    enrichment_source: "merged_v5",
  });
  computeScore(row);
  return row;
}

function buildNotFoundRow(contact: WorkbookContact, tier: EnrichmentTier, notes: string[], fiberCreditsCharged = 0) {
  const row = createEmptyOutputRow();
  row.full_name = contact.full_name;
  row.first_name = contact.first_name;
  row.last_name = contact.last_name;
  row.email = contact.email;
  row.company = contact.company;
  row.country = contact.country;
  row.title = contact.title;
  row.functional_area = contact.functional_area;
  row.contact_owner = contact.contact_owner;
  row.contact_tags = contact.contact_tags;
  row.phone = contact.phone;
  row.company_match_status = "not_found";
  row.enrichment_source = "not_found";
  row.enrichment_tier = tier;
  row.fiber_credits_charged = String(fiberCreditsCharged);
  row.notes = notes.join(" | ");
  row.enrichment_confidence = computeConfidence(row);
  computeScore(row);
  return row;
}

function buildFiberRow(contact: WorkbookContact, tier: EnrichmentTier, profile: FiberProfile, fiberCreditsCharged: number, notes: string[]) {
  const row = createEmptyOutputRow();
  const currentRole = summarizeCurrentRole(profile, contact.company);
  const linkedinUrl = bestLinkedinUrl(profile);
  const location = profile.inferred_location ?? null;
  const currentTitle = currentRole.primaryTitle || normalizeWhitespace(profile.current_job?.title);
  const currentCompany = currentRole.primaryCompany || normalizeWhitespace(profile.current_job?.company_name);
  const currentStartDate = [...(profile.experiences ?? [])]
    .filter((item) => Boolean(item.is_current))
    .sort((left, right) => parseDateValue(right.start_date) - parseDateValue(left.start_date))[0]?.start_date ?? "";

  row.full_name = contact.full_name;
  row.first_name = contact.first_name;
  row.last_name = contact.last_name;
  row.email = contact.email;
  row.company = contact.company;
  row.country = contact.country;
  row.title = contact.title;
  row.functional_area = contact.functional_area;
  row.contact_owner = contact.contact_owner;
  row.contact_tags = contact.contact_tags;
  row.phone = contact.phone;
  row.linkedin_profile_url = linkedinUrl;
  row.linkedin_headline = normalizeWhitespace(profile.headline);
  row.current_title = currentTitle;
  row.current_company = currentCompany;
  row.current_companies = currentRole.companies.join(" | ");
  row.company_match_status = currentRole.matchStatus;
  row.still_at_crm_company = String(currentRole.stillAtCrmCompany);
  row.moved_to = currentRole.movedTo;
  row.location_city = normalizeWhitespace(location?.city);
  row.location_country = normalizeWhitespace(location?.country_name ?? location?.country_code);
  row.industry_name = normalizeWhitespace(profile.industry_name);
  row.company_vertical = inferVertical(row.industry_name, row.current_company);
  row.follower_count = profile.follower_count == null ? "" : String(profile.follower_count);
  row.connection_count = profile.connection_count == null ? "" : String(profile.connection_count);
  row.current_role_start_date = normalizeWhitespace(currentStartDate);
  row.recent_job_change = String(withinLastMonths(currentStartDate, 6));
  row.tenure_months = monthsBetween(currentStartDate);
  row.enrichment_source = "fiber";
  row.enrichment_tier = tier;
  row.fiber_credits_charged = String(fiberCreditsCharged);
  row.notes = [...notes, ...currentRole.notes].join(" | ");
  row.enrichment_confidence = computeConfidence(row);
  computeScore(row);
  return row;
}

async function runWorkers<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>) {
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
  const fiberApiKey = getFiberApiKey();
  const allContacts = await loadWorkbookContacts(args.inputPath, args.sheetName);
  const limitedContacts = args.limit ? allContacts.slice(0, args.limit) : allContacts;
  const v5ByEmail = await loadV5ByEmail(args.v5Path);

  let tier1Rows = 0;
  let tier2Rows = 0;
  const selected = limitedContacts
    .map((contact) => {
      const selection = classifyTier(contact);
      if (selection.tier === "tier1_icp") {
        tier1Rows += 1;
      } else if (selection.tier === "tier2_director") {
        tier2Rows += 1;
      }
      return { contact, selection };
    })
    .filter((entry) => entry.selection.tier !== "skipped");

  const checkpoint = args.resume ? await loadCheckpoint(args.outputDir) : null;
  const processedKeys = new Set(checkpoint?.processedKeys ?? []);
  const rowsByKey = new Map((checkpoint?.rows ?? []).map((item) => [item.key, item.row]));
  const limiter = new TokenBucketRateLimiter(args.fiberRequestsPerMinute);

  for (const { contact, selection } of selected) {
    if (processedKeys.has(contact.source_key)) {
      continue;
    }

    if (contact.email) {
      const existing = v5ByEmail.get(normalizeText(contact.email));
      if (existing) {
        rowsByKey.set(contact.source_key, buildMergedRow(contact, existing));
        processedKeys.add(contact.source_key);
      }
    }
  }

  const pending = selected.filter(({ contact }) => !processedKeys.has(contact.source_key));
  const selectedRows = selected.length;

  console.log(
    `FRA enrichment on ${selectedRows} selected contacts from ${path.relative(process.cwd(), args.inputPath)} with concurrency=${args.concurrency}, fiberRpm=${args.fiberRequestsPerMinute}, merged=${rowsByKey.size}.`,
  );

  let processedInRun = 0;
  let flushChain: Promise<void> = Promise.resolve();
  const enqueueFlush = (force = false) => {
    if (!force && processedInRun % args.flushEvery !== 0 && processedInRun !== pending.length) {
      return;
    }
    flushChain = flushChain.then(async () => {
      await writeOutputs(
        args.outputDir,
        args.inputPath,
        args.v5Path,
        args,
        limitedContacts.length,
        selectedRows,
        tier1Rows,
        tier2Rows,
        rowsByKey,
        processedKeys,
      );
      console.log(`Processed ${processedInRun}/${pending.length} pending FRA lookups. Output rows=${rowsByKey.size}.`);
    });
  };

  await runWorkers(pending, args.concurrency, async ({ contact, selection }) => {
    const tier = selection.tier as EnrichmentTier;

    if (!contact.email) {
      rowsByKey.set(contact.source_key, buildNotFoundRow(contact, tier, ["Missing email; Fiber lookup skipped."]));
      processedKeys.add(contact.source_key);
      processedInRun += 1;
      enqueueFlush();
      return;
    }

    try {
      const response = await lookupFiberByEmail(contact.email, fiberApiKey, args, limiter);
      const profile = response.output?.data?.[0] ?? null;
      const credits = response.chargeInfo?.creditsCharged ?? 0;
      const notes: string[] = [];
      if (!profile) {
        notes.push("Fiber returned no profile.");
        rowsByKey.set(contact.source_key, buildNotFoundRow(contact, tier, notes, credits));
      } else {
        rowsByKey.set(contact.source_key, buildFiberRow(contact, tier, profile, credits, notes));
      }
    } catch (error) {
      const message = error instanceof Error ? `Fiber error: ${error.message}` : "Fiber error.";
      rowsByKey.set(contact.source_key, buildNotFoundRow(contact, tier, [message], 0));
    }

    processedKeys.add(contact.source_key);
    processedInRun += 1;
    enqueueFlush();
  });

  enqueueFlush(true);
  await flushChain;
  await writeOutputs(
    args.outputDir,
    args.inputPath,
    args.v5Path,
    args,
    limitedContacts.length,
    selectedRows,
    tier1Rows,
    tier2Rows,
    rowsByKey,
    processedKeys,
  );

  const summary = computeSummary(limitedContacts.length, selectedRows, tier1Rows, tier2Rows, [...rowsByKey.values()]);
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
