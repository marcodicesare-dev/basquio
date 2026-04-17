import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseCsv } from "csv-parse/sync";

import { loadBasquioScriptEnv } from "./load-app-env";

loadBasquioScriptEnv();

type ContactRow = Record<string, string>;
type CompanySignal = {
  company_key: string;
  company_name: string;
  analyst_result_count: number;
  brand_result_count: number;
  open_role_count: number;
  hiring_signal: "active" | "some" | "none";
  analyst_top_url: string;
  brand_top_url: string;
  source: string;
};

type Checkpoint = {
  generatedAt: string;
  completedLayers: string[];
  rows: ContactRow[];
  companySignals: CompanySignal[];
  meta: {
    notes: string[];
  };
};

type CliArgs = {
  inputPath: string;
  outputDir: string;
  concurrency: number;
  fiberRequestsPerMinute: number;
  firecrawlRequestsPerMinute: number;
  retryCount: number;
  retryBaseDelayMs: number;
  flushEvery: number;
  resume: boolean;
};

type FiberProfile = {
  url?: string | null;
  primary_slug?: string | null;
  headline?: string | null;
  industry_name?: string | null;
  follower_count?: number | null;
  connection_count?: number | null;
  inferred_location?: {
    city?: string | null;
    country_name?: string | null;
    country_code?: string | null;
  } | null;
  experiences?: Array<{
    is_current?: boolean | null;
    company_name?: string | null;
    start_date?: string | null;
    title?: string | null;
  }> | null;
  current_job?: {
    company_name?: string | null;
    title?: string | null;
  } | null;
};

type FiberLookupResponse = {
  output?: {
    data?: FiberProfile[] | null;
  } | null;
  chargeInfo?: {
    creditsCharged?: number;
  } | null;
};

type FiberPostsResponse = {
  output?: {
    data?: Array<{
      postId?: string;
      caption?: string | null;
      postUrl?: string | null;
      resharedPost?: boolean | null;
      postedAt?: {
        noEarlierThan?: string | null;
        noLaterThan?: string | null;
      } | null;
      engagement?: {
        numReactions?: number | null;
      } | null;
      author?: {
        name?: string | null;
        linkedinUrl?: string | null;
      } | null;
    }> | null;
  } | null;
  chargeInfo?: {
    creditsCharged?: number;
  } | null;
};

type FiberEmailValidationResponse = {
  output?: {
    verdict?: string | null;
    deliverability_score?: number | null;
    is_catch_all?: boolean | null;
  } | null;
  chargeInfo?: {
    creditsCharged?: number;
  } | null;
};

type FirecrawlSearchResponse = {
  success?: boolean;
  data?: {
    web?: Array<{
      url?: string;
      title?: string;
      description?: string;
    }>;
  };
};

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
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

const DEFAULT_INPUT_PATH = "output/contact-enrichment/weak-research/enriched-contacts-v4.csv";
const DEFAULT_OUTPUT_DIR = "output/contact-enrichment";
const FIBER_BASE_URL = process.env.FIBER_BASE_URL ?? "https://api.fiber.ai";
const FIRECRAWL_BASE_URL = process.env.FIRECRAWL_BASE_URL ?? "https://api.firecrawl.dev";
const ROLE_KEYWORDS = ["analyst", "analytics", "insight", "insights", "category", "brand", "marketing", "shopper", "consumer", "trade marketing", "data"];
const SENIORITY_KEYWORDS = ["director", "vp", "head", "manager", "lead", "senior director"];
const RELEVANT_VERTICAL_KEYWORDS = ["consumer goods", "consumer", "cpg", "fmcg", "retail", "food", "beverage", "pharma", "health", "beauty", "household"];
const IRRELEVANT_VERTICAL_KEYWORDS = ["software", "saas", "technology", "tech", "bank", "banking", "financial", "finance", "insurance", "consulting", "agency", "venture capital"];

function usageAndExit(): never {
  console.error("Usage: pnpm enrich:contacts:pass2 [--input <csv>] [--output-dir <dir>] [--resume]");
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const options: CliArgs = {
    inputPath: DEFAULT_INPUT_PATH,
    outputDir: DEFAULT_OUTPUT_DIR,
    concurrency: 8,
    fiberRequestsPerMinute: 90,
    firecrawlRequestsPerMinute: 60,
    retryCount: 4,
    retryBaseDelayMs: 1500,
    flushEvery: 20,
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
      case "--concurrency":
        options.concurrency = parsePositiveInt(argv[++index], "--concurrency");
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
      case "--flush-every":
        options.flushEvery = parsePositiveInt(argv[++index], "--flush-every");
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

async function sleep(ms: number) {
  if (ms <= 0) return;
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
  return normalizeText(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(s\.?p\.?a\.?|spa|srl|ltd|inc|group|international|socio unico|unipersonale|italy|italia)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function companyTokens(value: string | null | undefined) {
  return normalizeCompany(value).split(/\s+/).filter((token) => token.length > 2);
}

function parseBoolean(value: string | null | undefined) {
  return String(value).toLowerCase() === "true";
}

function parseNumber(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatBoolean(value: boolean) {
  return value ? "true" : "false";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function monthsBetween(dateIso: string | null | undefined) {
  if (!dateIso) return "";
  const start = new Date(dateIso);
  if (Number.isNaN(start.getTime())) return "";
  const now = new Date();
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  return String(Math.max(months, 0));
}

function withinLastMonths(dateIso: string | null | undefined, months: number) {
  if (!dateIso) return false;
  const start = new Date(dateIso);
  if (Number.isNaN(start.getTime())) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return start >= cutoff;
}

function containsKeyword(haystack: string, keywords: string[]) {
  const normalized = haystack.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

function isRelevantVertical(text: string) {
  return RELEVANT_VERTICAL_KEYWORDS.some((keyword) => text.includes(keyword));
}

function isIrrelevantVertical(text: string) {
  return IRRELEVANT_VERTICAL_KEYWORDS.some((keyword) => text.includes(keyword));
}

function classifyTopics(texts: string[]) {
  const combined = normalizeText(texts.join(" "));
  const topics: string[] = [];
  if (combined.includes("data") || combined.includes("analytics") || combined.includes("insight")) topics.push("data/analytics/insights");
  if (combined.includes("marketing") || combined.includes("brand")) topics.push("marketing/brand");
  if (combined.includes("hiring") || combined.includes("job") || combined.includes("opportunity")) topics.push("career/hiring");
  if (combined.includes("food") || combined.includes("beverage") || combined.includes("cpg") || combined.includes("retail") || combined.includes("fmcg")) topics.push("industry/fmcg");
  return [...new Set(topics)];
}

function hasCompanyEvidence(text: string, companyName: string) {
  const haystack = normalizeText(text);
  return companyTokens(companyName).some((token) => haystack.includes(token));
}

function filterJobResults(results: Array<{ title?: string; description?: string; url?: string }>, companyName: string, roleKeywords: string[]) {
  return results.filter((item) => {
    const text = normalizeText(`${item.title ?? ""} ${item.description ?? ""}`);
    return (item.url ?? "").includes("linkedin.com/jobs")
      && hasCompanyEvidence(text, companyName)
      && roleKeywords.some((keyword) => text.includes(keyword));
  });
}

function escapeCsv(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function toCsv(rows: ContactRow[] | CompanySignal[]) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0] as Record<string, string>);
  const lines = [columns.join(",")];
  for (const row of rows as Array<Record<string, string | number>>) {
    lines.push(columns.map((column) => escapeCsv(String(row[column] ?? ""))).join(","));
  }
  return lines.join("\n");
}

async function parseCsvFile(filePath: string) {
  const contents = await readFile(filePath, "utf8");
  return parseCsv(contents, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as ContactRow[];
}

function getFiberApiKey() {
  const apiKey = process.env.FIBER_API_KEY;
  if (!apiKey) throw new Error("FIBER_API_KEY is required.");
  return apiKey;
}

function getFirecrawlApiKey() {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is required.");
  return apiKey;
}

function isRetryableError(error: unknown) {
  if (error instanceof ApiError) {
    return error.status === 408 || error.status === 409 || error.status === 425 || error.status === 429 || error.status >= 500;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("timeout") || message.includes("network") || message.includes("fetch failed");
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
      const delayMs = args.retryBaseDelayMs * 2 ** attempt;
      console.warn(`${label} failed on attempt ${attempt + 1}; retrying in ${delayMs}ms.`);
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
  timeoutMs = 30_000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) as T : {} as T;
    if (!response.ok) {
      throw new ApiError(`${response.status} ${response.statusText}`, response.status);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function bestLinkedinUrl(profile: FiberProfile) {
  return normalizeWhitespace(profile.url) || (profile.primary_slug ? `https://www.linkedin.com/in/${normalizeWhitespace(profile.primary_slug)}` : "");
}

function summarizeCurrentExperience(profile: FiberProfile) {
  const experiences = [...(profile.experiences ?? [])]
    .filter((item) => Boolean(item.is_current))
    .sort((left, right) => Date.parse(right.start_date ?? "") - Date.parse(left.start_date ?? ""));
  const primary = experiences[0];
  return {
    company: normalizeWhitespace(primary?.company_name || profile.current_job?.company_name),
    title: normalizeWhitespace(primary?.title || profile.current_job?.title),
    startDate: normalizeWhitespace(primary?.start_date),
  };
}

function authorLooksLikeContact(authorName: string, fullName: string) {
  const author = normalizeText(authorName);
  const full = normalizeText(fullName);
  if (!author || !full) return false;
  const nameTokens = full.split(/\s+/).filter(Boolean);
  return nameTokens.filter((token) => token.length > 2 && author.includes(token)).length >= Math.min(2, nameTokens.length);
}

function computeScoreV2(row: ContactRow, companySignal: CompanySignal | undefined) {
  let score = 0;
  const reasons: string[] = [];
  const roleText = normalizeText(`${row.linkedin_headline} ${row.current_title} ${row.title}`);
  const verticalText = normalizeText(`${row.company_vertical} ${row.current_company}`);

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

  const topics = normalizeText(row.post_topics);
  const isActivePoster = parseBoolean(row.is_active_poster);
  if (isActivePoster && (topics.includes("data/analytics/insights") || topics.includes("data") || topics.includes("analytics") || topics.includes("insight"))) {
    score += 2;
    reasons.push("active poster on relevant topics");
  } else if (isActivePoster) {
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
  if (companySignal?.hiring_signal === "active") {
    score += 1;
    reasons.push("company is actively hiring relevant roles");
  }
  if (parseBoolean(row.recent_job_change)) {
    score += 1;
    reasons.push("recent job change");
  }
  if (isIrrelevantVertical(verticalText)) {
    score -= 2;
    reasons.push("current company looks outside the target vertical");
  }
  if (!normalizeWhitespace(row.linkedin_profile_url)) {
    score -= 1;
    reasons.push("no LinkedIn URL");
  }
  if (["invalid", "risky", "undeliverable"].includes(normalizeText(row.email_verdict))) {
    score -= 1;
    reasons.push("email looks stale");
  }
  if (!normalizeWhitespace(row.current_company) && !normalizeWhitespace(row.current_title)) {
    score -= 1;
    reasons.push("no current role data");
  }
  if (normalizeText(row.enrichment_source).startsWith("not_found")) {
    score -= 3;
    reasons.push("profile not found in primary enrichment");
  }

  return {
    score: clamp(score, 0, 10),
    reasons,
  };
}

async function runWorkers<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index] as T, index);
    }
  });
  await Promise.all(workers);
}

async function loadCheckpoint(outputDir: string) {
  const filePath = path.join(outputDir, "pass2-checkpoint.json");
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Checkpoint;
  } catch {
    return null;
  }
}

function upsertCompanySignals(rows: CompanySignal[]) {
  return new Map(rows.map((row) => [row.company_key, row]));
}

async function writeOutputs(outputDir: string, rows: ContactRow[], companySignals: CompanySignal[], completedLayers: string[], notes: string[]) {
  await mkdir(outputDir, { recursive: true });
  const companyMap = upsertCompanySignals(companySignals);
  const scoredRows: ContactRow[] = [...rows]
    .map((row) => {
      const companySignal = companyMap.get(companyKeyForRow(row));
      const computed = computeScoreV2(row, companySignal);
      return {
        ...row,
        company_hiring_signal: companySignal?.hiring_signal ?? row.company_hiring_signal ?? "none",
        company_open_analyst_roles: companySignal ? String(companySignal.analyst_result_count) : row.company_open_analyst_roles || "0",
        company_open_brand_roles: companySignal ? String(companySignal.brand_result_count) : row.company_open_brand_roles || "0",
        signal_score_v2: String(computed.score),
        signal_reasons_v2: computed.reasons.join("; "),
      };
    });
  const sortedRows = scoredRows.sort((left, right) => Number(right.signal_score_v2) - Number(left.signal_score_v2));

  const moversEmail = sortedRows.filter((row) => row.company_match_status === "moved");
  const activePosters = sortedRows.filter((row) => parseBoolean(row.is_active_poster));
  const hiringCompanies = [...companySignals].filter((row) => row.hiring_signal !== "none").sort((left, right) => right.open_role_count - left.open_role_count);
  const checkpoint: Checkpoint = {
    generatedAt: new Date().toISOString(),
    completedLayers,
    rows: sortedRows,
    companySignals,
    meta: { notes },
  };

  await writeFile(path.join(outputDir, "enriched-contacts-v5.csv"), toCsv(sortedRows), "utf8");
  await writeFile(path.join(outputDir, "movers-email-status.csv"), toCsv(moversEmail), "utf8");
  await writeFile(path.join(outputDir, "active-posters.csv"), toCsv(activePosters), "utf8");
  await writeFile(path.join(outputDir, "hiring-companies.csv"), toCsv(hiringCompanies as unknown as ContactRow[]), "utf8");
  await writeFile(path.join(outputDir, "pass2-checkpoint.json"), JSON.stringify(checkpoint, null, 2), "utf8");
}

function companyKeyForRow(row: ContactRow) {
  return normalizeCompany(row.current_company || row.company);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fiberApiKey = getFiberApiKey();
  const firecrawlApiKey = getFirecrawlApiKey();
  const fiberLimiter = new RateLimiter(args.fiberRequestsPerMinute);
  const firecrawlLimiter = new RateLimiter(args.firecrawlRequestsPerMinute);
  const checkpoint = args.resume ? await loadCheckpoint(args.outputDir) : null;
  let rows = checkpoint?.rows ?? await parseCsvFile(args.inputPath);
  let companySignals = checkpoint?.companySignals ?? [];
  const completedLayers = new Set(checkpoint?.completedLayers ?? []);
  const notes = checkpoint?.meta.notes ?? [];

  for (const row of rows) {
    row.post_count_90d ??= "";
    row.latest_post_date ??= "";
    row.latest_post_text ??= "";
    row.avg_engagement ??= "";
    row.post_topics ??= "";
    row.is_active_poster ??= "false";
    row.email_verdict ??= "";
    row.email_deliverability_score ??= "";
    row.email_is_catch_all ??= "";
    row.company_hiring_signal ??= "";
    row.company_open_analyst_roles ??= "";
    row.company_open_brand_roles ??= "";
    row.current_role_start_date ??= "";
    row.recent_job_change ??= "false";
    row.tenure_months ??= "";
    row.signal_score_v2 ??= "";
    row.signal_reasons_v2 ??= "";
  }

  console.log(`Pass 2 starting on ${rows.length} rows.`);

  if (!completedLayers.has("layer4-current-role")) {
    const pending = rows.filter((row) => !row.current_role_start_date);
    let completed = 0;
    let flushChain: Promise<void> = Promise.resolve();
    const flush = (force = false) => {
      if (!force && completed % args.flushEvery !== 0 && completed !== pending.length) return;
      flushChain = flushChain.then(() => writeOutputs(args.outputDir, rows, companySignals, [...completedLayers], notes));
    };

    await runWorkers(pending, args.concurrency, async (row) => {
      const response = await withRetries(`Fiber restore for ${row.email}`, args, () =>
        fiberLimiter.schedule(() =>
          postJson<FiberLookupResponse>(
            `${FIBER_BASE_URL}/v1/email-to-person/single`,
            { apiKey: fiberApiKey, email: row.email },
            {},
            35_000,
          ),
        ),
      ).catch(() => null);
      const profile = response?.output?.data?.[0];
      if (profile) {
        const current = summarizeCurrentExperience(profile);
        row.current_role_start_date = current.startDate;
        row.recent_job_change = formatBoolean(withinLastMonths(current.startDate, 6));
        row.tenure_months = monthsBetween(current.startDate);
        if (!row.current_company && current.company) row.current_company = current.company;
        if (!row.current_title && current.title) row.current_title = current.title;
      }
      completed += 1;
      flush();
      if (completed % args.flushEvery === 0 || completed === pending.length) {
        console.log(`Layer 4: ${completed}/${pending.length}`);
      }
    });
    flush(true);
    await flushChain;
    completedLayers.add("layer4-current-role");
    notes.push("Layer 4 required a restorative Fiber profile pass because pass-1 outputs did not retain raw experiences.");
    await writeOutputs(args.outputDir, rows, companySignals, [...completedLayers], notes);
  }

  if (!completedLayers.has("layer2-email-validation")) {
    const pending = rows.filter((row) => row.company_match_status === "moved" && !row.email_verdict);
    let completed = 0;
    let flushChain: Promise<void> = Promise.resolve();
    const flush = (force = false) => {
      if (!force && completed % args.flushEvery !== 0 && completed !== pending.length) return;
      flushChain = flushChain.then(() => writeOutputs(args.outputDir, rows, companySignals, [...completedLayers], notes));
    };

    await runWorkers(pending, args.concurrency, async (row) => {
      const response = await withRetries(`Email validation for ${row.email}`, args, () =>
        fiberLimiter.schedule(() =>
          postJson<FiberEmailValidationResponse>(
            `${FIBER_BASE_URL}/v1/validate-email/single`,
            { apiKey: fiberApiKey, email: row.email },
            {},
            20_000,
          ),
        ),
      ).catch(() => null);
      const verdict = normalizeText(response?.output?.verdict);
      row.email_verdict = verdict === "undeliverable" ? "invalid" : normalizeWhitespace(response?.output?.verdict);
      row.email_deliverability_score = response?.output?.deliverability_score != null ? String(response.output.deliverability_score) : "";
      row.email_is_catch_all = formatBoolean(Boolean(response?.output?.is_catch_all));
      completed += 1;
      flush();
      if (completed % args.flushEvery === 0 || completed === pending.length) {
        console.log(`Layer 2: ${completed}/${pending.length}`);
      }
    });
    flush(true);
    await flushChain;
    completedLayers.add("layer2-email-validation");
    await writeOutputs(args.outputDir, rows, companySignals, [...completedLayers], notes);
  }

  if (!completedLayers.has("layer1-linkedin-posts")) {
    const pending = rows.filter((row) => parseNumber(row.signal_score) >= 8 && Boolean(row.linkedin_profile_url) && !row.latest_post_date && !row.post_count_90d);
    let completed = 0;
    let flushChain: Promise<void> = Promise.resolve();
    const flush = (force = false) => {
      if (!force && completed % args.flushEvery !== 0 && completed !== pending.length) return;
      flushChain = flushChain.then(() => writeOutputs(args.outputDir, rows, companySignals, [...completedLayers], notes));
    };

    await runWorkers(pending, args.concurrency, async (row) => {
      const response = await withRetries(`Posts for ${row.full_name}`, args, () =>
        fiberLimiter.schedule(() =>
          postJson<FiberPostsResponse>(
            `${FIBER_BASE_URL}/v1/linkedin-live-fetch/profile-posts`,
            { apiKey: fiberApiKey, identifier: row.linkedin_profile_url },
            {},
            65_000,
          ),
        ),
      ).catch(() => null);

      const allPosts = response?.output?.data ?? [];
      const originalPosts = allPosts.filter((post) => authorLooksLikeContact(normalizeWhitespace(post.author?.name), row.full_name));
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      const recentPosts = originalPosts.filter((post) => {
        const iso = post.postedAt?.noLaterThan || post.postedAt?.noEarlierThan;
        if (!iso) return false;
        const timestamp = new Date(iso);
        return !Number.isNaN(timestamp.getTime()) && timestamp >= cutoff;
      }).sort((left, right) => Date.parse(right.postedAt?.noLaterThan ?? right.postedAt?.noEarlierThan ?? "") - Date.parse(left.postedAt?.noLaterThan ?? left.postedAt?.noEarlierThan ?? ""));

      row.post_count_90d = String(recentPosts.length);
      row.latest_post_date = normalizeWhitespace(recentPosts[0]?.postedAt?.noLaterThan || recentPosts[0]?.postedAt?.noEarlierThan);
      row.latest_post_text = normalizeWhitespace(recentPosts[0]?.caption).slice(0, 200);
      const avgEngagement = recentPosts.length > 0
        ? recentPosts.reduce((sum, post) => sum + Number(post.engagement?.numReactions ?? 0), 0) / recentPosts.length
        : 0;
      row.avg_engagement = recentPosts.length > 0 ? avgEngagement.toFixed(1) : "";
      row.post_topics = classifyTopics(recentPosts.map((post) => normalizeWhitespace(post.caption))).join("; ");
      row.is_active_poster = formatBoolean(recentPosts.length >= 2);

      completed += 1;
      flush();
      if (completed % args.flushEvery === 0 || completed === pending.length) {
        console.log(`Layer 1: ${completed}/${pending.length}`);
      }
    });
    flush(true);
    await flushChain;
    completedLayers.add("layer1-linkedin-posts");
    await writeOutputs(args.outputDir, rows, companySignals, [...completedLayers], notes);
  }

  if (!completedLayers.has("layer3-hiring-signals")) {
    const companyRows = new Map<string, { company_name: string }>();
    for (const row of rows.filter((item) => parseNumber(item.signal_score) >= 8)) {
      const key = companyKeyForRow(row);
      if (!key) continue;
      companyRows.set(key, { company_name: row.current_company || row.company });
    }
    const pendingCompanies = [...companyRows.entries()]
      .filter(([key]) => !companySignals.some((signal) => signal.company_key === key))
      .map(([company_key, value]) => ({ company_key, company_name: value.company_name }));

    let completed = 0;
    let flushChain: Promise<void> = Promise.resolve();
    const flush = (force = false) => {
      if (!force && completed % args.flushEvery !== 0 && completed !== pendingCompanies.length) return;
      flushChain = flushChain.then(() => writeOutputs(args.outputDir, rows, companySignals, [...completedLayers], notes));
    };

    await runWorkers(pendingCompanies, args.concurrency, async (company) => {
      const analystQuery = `"${company.company_name}" careers analyst OR insights site:linkedin.com/jobs`;
      const brandQuery = `"${company.company_name}" careers \"brand manager\" OR marketing site:linkedin.com/jobs`;
      const analystResponse = await withRetries(`Hiring search analyst for ${company.company_name}`, args, () =>
        firecrawlLimiter.schedule(() =>
          postJson<FirecrawlSearchResponse>(
            `${FIRECRAWL_BASE_URL}/v2/search`,
            { query: analystQuery, limit: 5 },
            { Authorization: `Bearer ${firecrawlApiKey}` },
            25_000,
          ),
        ),
      ).catch(() => null);
      const brandResponse = await withRetries(`Hiring search brand for ${company.company_name}`, args, () =>
        firecrawlLimiter.schedule(() =>
          postJson<FirecrawlSearchResponse>(
            `${FIRECRAWL_BASE_URL}/v2/search`,
            { query: brandQuery, limit: 5 },
            { Authorization: `Bearer ${firecrawlApiKey}` },
            25_000,
          ),
        ),
      ).catch(() => null);

      const analystResults = filterJobResults(
        analystResponse?.data?.web ?? [],
        company.company_name,
        ["analyst", "analytics", "insights", "business intelligence", "market intelligence", "category"],
      );
      const brandResults = filterJobResults(
        brandResponse?.data?.web ?? [],
        company.company_name,
        ["brand manager", "marketing manager", "trade marketing", "category manager", "brand"],
      );
      const openRoleCount = analystResults.length + brandResults.length;
      const hiringSignal: CompanySignal["hiring_signal"] = openRoleCount >= 2 ? "active" : openRoleCount === 1 ? "some" : "none";
      companySignals.push({
        company_key: company.company_key,
        company_name: company.company_name,
        analyst_result_count: analystResults.length,
        brand_result_count: brandResults.length,
        open_role_count: openRoleCount,
        hiring_signal: hiringSignal,
        analyst_top_url: normalizeWhitespace(analystResults[0]?.url),
        brand_top_url: normalizeWhitespace(brandResults[0]?.url),
        source: "firecrawl_search",
      });

      completed += 1;
      flush();
      if (completed % args.flushEvery === 0 || completed === pendingCompanies.length) {
        console.log(`Layer 3: ${completed}/${pendingCompanies.length}`);
      }
    });
    flush(true);
    await flushChain;
    completedLayers.add("layer3-hiring-signals");
    notes.push("Layer 3 used Firecrawl search directly because the spec's Fiber job-search payload did not validate against the live API.");
    await writeOutputs(args.outputDir, rows, companySignals, [...completedLayers], notes);
  }

  await writeOutputs(args.outputDir, rows, companySignals, [...completedLayers], notes);
  console.log(JSON.stringify({
    rows: rows.length,
    score8plus: rows.filter((row) => parseNumber(row.signal_score) >= 8).length,
    movers: rows.filter((row) => row.company_match_status === "moved").length,
    activePosters: rows.filter((row) => parseBoolean(row.is_active_poster)).length,
    companiesWithHiring: companySignals.filter((row) => row.hiring_signal !== "none").length,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
