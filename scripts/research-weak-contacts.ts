import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseCsv } from "csv-parse/sync";

import { loadBasquioScriptEnv } from "./load-app-env";

loadBasquioScriptEnv();

type WeakRow = Record<string, string>;

type FirecrawlSearchResult = {
  url?: string;
  title?: string;
  description?: string;
  position?: number;
};

type FirecrawlSearchResponse = {
  success?: boolean;
  data?: {
    web?: FirecrawlSearchResult[];
  };
};

type ResearchRow = {
  full_name: string;
  email: string;
  company: string;
  original_title: string;
  original_enrichment_source: string;
  original_linkedin_profile_url: string;
  research_status: "found" | "not_found";
  recovered_linkedin_url: string;
  recovered_result_title: string;
  recovered_result_description: string;
  recovered_query: string;
  recovered_confidence: string;
  recovered_company_hint: string;
  recovered_role_hint: string;
  notes: string;
};

type CliArgs = {
  inputPath: string;
  baseCsvPath: string;
  outputDir: string;
  concurrency: number;
  firecrawlRequestsPerMinute: number;
  retryCount: number;
  retryBaseDelayMs: number;
  flushEvery: number;
  resume: boolean;
};

type Checkpoint = {
  generatedAt: string;
  rows: ResearchRow[];
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

function usageAndExit(): never {
  console.error(
    "Usage: pnpm research:weak-contacts --input <weak-csv> [--base-csv <enriched-csv>] [--output-dir <dir>] [--resume]",
  );
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const options: CliArgs = {
    inputPath: "output/contact-enrichment/weak-records.csv",
    baseCsvPath: "output/contact-enrichment/enriched-contacts.csv",
    outputDir: "output/contact-enrichment/weak-research",
    concurrency: 8,
    firecrawlRequestsPerMinute: 60,
    retryCount: 4,
    retryBaseDelayMs: 1500,
    flushEvery: 10,
    resume: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--input":
        options.inputPath = argv[++index] ?? usageAndExit();
        break;
      case "--base-csv":
        options.baseCsvPath = argv[++index] ?? usageAndExit();
        break;
      case "--output-dir":
        options.outputDir = argv[++index] ?? usageAndExit();
        break;
      case "--concurrency":
        options.concurrency = parsePositiveInt(argv[++index], "--concurrency");
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

function normalizeWhitespace(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeSearchText(value: string | null | undefined) {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function stripCompanyNoise(value: string) {
  return normalizeWhitespace(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(s\.?p\.?a\.?|spa|srl|ltd|inc|group|international|socio unico|unipersonale)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsvFile<T>(filePath: string) {
  return readFile(filePath, "utf8").then((contents) =>
    parseCsv(contents, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as T[],
  );
}

function getFirecrawlApiKey() {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is required.");
  }
  return apiKey;
}

async function sleep(ms: number) {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
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

async function firecrawlSearch(query: string, apiKey: string) {
  const response = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      limit: 5,
    }),
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) as FirecrawlSearchResponse : {};
  if (!response.ok) {
    throw new ApiError(`${response.status} ${response.statusText}`, response.status);
  }
  return json;
}

function extractEmailLocalPart(email: string) {
  return normalizeWhitespace(email).split("@")[0] ?? "";
}

function buildQueries(row: WeakRow) {
  const fullName = normalizeWhitespace(row.full_name);
  const company = stripCompanyNoise(row.company);
  const title = normalizeWhitespace(row.title);
  const localPart = extractEmailLocalPart(row.email);

  return [
    `"${fullName}" "${company}" site:linkedin.com/in/`,
    `"${fullName}" site:linkedin.com/in/`,
    `"${fullName}" "${title}" site:linkedin.com/in/`,
    `"${localPart}" site:linkedin.com/in/`,
  ];
}

function scoreCandidate(row: WeakRow, result: FirecrawlSearchResult) {
  const haystack = normalizeSearchText(`${result.title ?? ""} ${result.description ?? ""} ${result.url ?? ""}`);
  const nameTokens = normalizeSearchText(row.full_name).split(/\s+/).filter(Boolean);
  const companyTokens = normalizeSearchText(stripCompanyNoise(row.company)).split(/\s+/).filter((token) => token.length > 2);
  const titleTokens = normalizeSearchText(row.title).split(/\s+/).filter((token) => token.length > 3);

  let score = 0;
  for (const token of nameTokens) {
    if (haystack.includes(token)) {
      score += 2;
    }
  }
  for (const token of companyTokens.slice(0, 4)) {
    if (haystack.includes(token)) {
      score += 1;
    }
  }
  for (const token of titleTokens.slice(0, 4)) {
    if (haystack.includes(token)) {
      score += 0.5;
    }
  }
  if ((result.url ?? "").includes("/in/")) {
    score += 1;
  }
  return score;
}

function looksRelevant(result: FirecrawlSearchResult) {
  const url = normalizeWhitespace(result.url);
  return /linkedin\.com\/(in|pub)\//i.test(url);
}

function bestResult(row: WeakRow, results: FirecrawlSearchResult[]) {
  return [...results]
    .filter(looksRelevant)
    .sort((left, right) => scoreCandidate(row, right) - scoreCandidate(row, left))[0] ?? null;
}

function confidenceFor(row: WeakRow, result: FirecrawlSearchResult) {
  const score = scoreCandidate(row, result);
  if (score >= 7) return 0.95;
  if (score >= 5) return 0.8;
  if (score >= 3.5) return 0.65;
  return 0.45;
}

function companyHint(result: FirecrawlSearchResult) {
  const title = normalizeWhitespace(result.title);
  const description = normalizeWhitespace(result.description);
  const text = `${title} ${description}`;
  const match = text.match(/(?:at|@|\||-)\s*([^|·,-]{3,60})/i);
  return normalizeWhitespace(match?.[1]);
}

function roleHint(result: FirecrawlSearchResult) {
  return normalizeWhitespace(result.title)
    .replace(/\s*\|\s*LinkedIn.*$/i, "")
    .replace(/\s*-\s*LinkedIn.*$/i, "");
}

function toCsv(rows: Record<string, string>[]) {
  if (rows.length === 0) {
    return "";
  }
  const columns = Object.keys(rows[0]) as string[];
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsv(row[column] ?? "")).join(","));
  }
  return lines.join("\n");
}

function escapeCsv(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

async function loadCheckpoint(outputDir: string) {
  const checkpointPath = path.join(outputDir, "checkpoint.json");
  try {
    return JSON.parse(await readFile(checkpointPath, "utf8")) as Checkpoint;
  } catch {
    return null;
  }
}

async function writeOutputs(outputDir: string, researchRows: ResearchRow[], mergedRows: WeakRow[]) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "weak-records-research.csv"), toCsv(researchRows), "utf8");
  await writeFile(path.join(outputDir, "weak-records-merged.csv"), toCsv(mergedRows), "utf8");
  await writeFile(
    path.join(outputDir, "checkpoint.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), rows: researchRows } satisfies Checkpoint, null, 2),
    "utf8",
  );
  const summary = {
    researchedRows: researchRows.length,
    found: researchRows.filter((row) => row.research_status === "found").length,
    notFound: researchRows.filter((row) => row.research_status === "not_found").length,
    averageConfidence: Number(
      (
        researchRows.reduce((sum, row) => sum + Number(row.recovered_confidence || 0), 0)
        / Math.max(researchRows.length, 1)
      ).toFixed(2),
    ),
  };
  await writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
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

async function researchRow(row: WeakRow, args: CliArgs, apiKey: string, limiter: RateLimiter): Promise<ResearchRow> {
  const queries = buildQueries(row);
  const notes: string[] = [];

  for (const query of queries) {
    try {
      const response = await withRetries(`Firecrawl search for ${row.email}`, args, () =>
        limiter.schedule(() => firecrawlSearch(query, apiKey)),
      );
      const candidate = bestResult(row, response.data?.web ?? []);
      if (!candidate?.url) {
        continue;
      }
      const confidence = confidenceFor(row, candidate);
      return {
        full_name: row.full_name,
        email: row.email,
        company: row.company,
        original_title: row.title,
        original_enrichment_source: row.enrichment_source,
        original_linkedin_profile_url: row.linkedin_profile_url,
        research_status: "found",
        recovered_linkedin_url: normalizeWhitespace(candidate.url),
        recovered_result_title: normalizeWhitespace(candidate.title),
        recovered_result_description: normalizeWhitespace(candidate.description),
        recovered_query: query,
        recovered_confidence: confidence.toFixed(2),
        recovered_company_hint: companyHint(candidate),
        recovered_role_hint: roleHint(candidate),
        notes: notes.join(" | "),
      };
    } catch (error) {
      notes.push(error instanceof Error ? error.message : "Search failed.");
    }
  }

  return {
    full_name: row.full_name,
    email: row.email,
    company: row.company,
    original_title: row.title,
    original_enrichment_source: row.enrichment_source,
    original_linkedin_profile_url: row.linkedin_profile_url,
    research_status: "not_found",
    recovered_linkedin_url: "",
    recovered_result_title: "",
    recovered_result_description: "",
    recovered_query: "",
    recovered_confidence: "0.00",
    recovered_company_hint: "",
    recovered_role_hint: "",
    notes: notes.join(" | "),
  };
}

function mergeWeakRows(weakRows: WeakRow[], researchRows: ResearchRow[]) {
  const researchByEmail = new Map(researchRows.map((row) => [row.email.toLowerCase(), row]));
  return weakRows.map((row) => {
    const research = researchByEmail.get(row.email.toLowerCase());
    if (!research || research.research_status !== "found") {
      return row;
    }
    return {
      ...row,
      linkedin_profile_url: research.recovered_linkedin_url,
      linkedin_headline: row.linkedin_headline || research.recovered_role_hint,
      current_company: row.current_company || research.recovered_company_hint,
      enrichment_source: `${row.enrichment_source}+firecrawl_research`,
      notes: [row.notes, `Second pass query: ${research.recovered_query}`, `Confidence ${research.recovered_confidence}`]
        .filter(Boolean)
        .join(" | "),
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = getFirecrawlApiKey();
  const limiter = new RateLimiter(args.firecrawlRequestsPerMinute);
  const weakRows = await parseCsvFile<WeakRow>(args.inputPath);
  const baseRows = await parseCsvFile<WeakRow>(args.baseCsvPath);
  const checkpoint = args.resume ? await loadCheckpoint(args.outputDir) : null;
  const completedByEmail = new Map((checkpoint?.rows ?? []).map((row) => [row.email.toLowerCase(), row]));
  const pending = weakRows.filter((row) => !completedByEmail.has(row.email.toLowerCase()));

  console.log(
    `Researching ${weakRows.length} weak rows with concurrency=${args.concurrency}, firecrawlRpm=${args.firecrawlRequestsPerMinute}`,
  );

  let completed = 0;
  let flushChain: Promise<void> = Promise.resolve();
  const researchByEmail = new Map(completedByEmail);

  const flush = (force = false) => {
    if (!force && completed % args.flushEvery !== 0 && completed !== pending.length) {
      return;
    }
    flushChain = flushChain.then(async () => {
      const researchRows = weakRows
        .map((row) => researchByEmail.get(row.email.toLowerCase()))
        .filter(Boolean) as ResearchRow[];
      const mergedWeak = mergeWeakRows(weakRows, researchRows);
      await writeOutputs(args.outputDir, researchRows, mergedWeak);
      console.log(`Researched ${completed}/${pending.length} pending weak rows.`);
    });
  };

  await runWorkers(pending, args.concurrency, async (row) => {
    const research = await researchRow(row, args, apiKey, limiter);
    researchByEmail.set(row.email.toLowerCase(), research);
    completed += 1;
    flush();
  });

  flush(true);
  await flushChain;

  const researchRows = weakRows
    .map((row) => researchByEmail.get(row.email.toLowerCase()))
    .filter(Boolean) as ResearchRow[];
  const mergedWeak = mergeWeakRows(weakRows, researchRows);
  const mergedByEmail = new Map(mergedWeak.map((row) => [row.email.toLowerCase(), row]));
  const fullMerged = baseRows.map((row) => mergedByEmail.get(row.email.toLowerCase()) ?? row);

  await writeFile(path.join(args.outputDir, "enriched-contacts-v2.csv"), toCsv(fullMerged), "utf8");
  const found = researchRows.filter((row) => row.research_status === "found").length;
  console.log(JSON.stringify({ weakRows: weakRows.length, found, notFound: weakRows.length - found }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
