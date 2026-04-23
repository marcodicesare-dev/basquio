/**
 * NIQ services catalog parser per spec §6.12.
 *
 * The catalog lives as a markdown file at
 * docs/domain-knowledge/niq-services-catalog.md. Rows in the first
 * table are parsed into typed records at runtime and fed to the
 * suggestServices chat tool alongside scope context. The parser also
 * detects the pending-review notice at the top of the file so the
 * tool can surface a footer until Rossella and Francesco sign the
 * catalog off.
 *
 * Design choices:
 * - Module-level cache per file path. Catalog content rarely changes
 *   in production; re-reading the file on every tool call is waste.
 *   Tests pass skipCache: true to force a fresh read.
 * - Robust column count: rows with the wrong number of cells are
 *   dropped rather than thrown so a bad edit does not kill the tool.
 *   Empty cells stay empty strings (not null).
 * - The pending-review detection is a substring match on the canonical
 *   phrase "Catalog pending NIQ-side review" so editors can reformat
 *   the surrounding prose freely.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

export type NiqServiceEntry = {
  serviceName: string;
  description: string;
  typicalDataInputs: string;
  typicalAnalystQuestion: string;
  typicalDeliverable: string;
};

export type NiqServicesCatalog = {
  entries: NiqServiceEntry[];
  reviewPending: boolean;
  sourceFile: string;
};

export class NiqServicesCatalogNotFoundError extends Error {
  constructor(filePath: string, cause?: unknown) {
    super(
      `NIQ services catalog not found at ${filePath}. See spec §6.12: ` +
        `the file docs/domain-knowledge/niq-services-catalog.md must exist ` +
        `for the suggestServices tool to operate.`,
    );
    this.name = "NiqServicesCatalogNotFoundError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

const DEFAULT_CATALOG_REL_PATH = "docs/domain-knowledge/niq-services-catalog.md";
const REVIEW_PENDING_SENTINEL = "catalog pending niq-side review";

const EXPECTED_COLUMNS = [
  "service_name",
  "description",
  "typical_data_inputs",
  "typical_analyst_question",
  "typical_deliverable",
] as const;

const cache = new Map<string, NiqServicesCatalog>();

export type LoadNiqServicesCatalogOptions = {
  filePath?: string;
  skipCache?: boolean;
  cwd?: string;
};

export async function loadNiqServicesCatalog(
  opts: LoadNiqServicesCatalogOptions = {},
): Promise<NiqServicesCatalog> {
  const filePath = resolveCatalogPath(opts);
  if (!opts.skipCache) {
    const hit = cache.get(filePath);
    if (hit) return hit;
  }
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    throw new NiqServicesCatalogNotFoundError(filePath, error);
  }
  const parsed = parseNiqServicesCatalog(raw, filePath);
  cache.set(filePath, parsed);
  return parsed;
}

export function clearNiqServicesCatalogCache(): void {
  cache.clear();
}

export function parseNiqServicesCatalog(
  markdown: string,
  sourceFile = DEFAULT_CATALOG_REL_PATH,
): NiqServicesCatalog {
  const reviewPending = detectReviewPending(markdown);
  const entries = parseFirstTable(markdown);
  return { entries, reviewPending, sourceFile };
}

function resolveCatalogPath(opts: LoadNiqServicesCatalogOptions): string {
  if (opts.filePath) {
    return path.isAbsolute(opts.filePath)
      ? opts.filePath
      : path.join(opts.cwd ?? process.cwd(), opts.filePath);
  }
  return path.join(opts.cwd ?? process.cwd(), DEFAULT_CATALOG_REL_PATH);
}

function detectReviewPending(markdown: string): boolean {
  return markdown.toLowerCase().includes(REVIEW_PENDING_SENTINEL);
}

function parseFirstTable(markdown: string): NiqServiceEntry[] {
  const lines = markdown.split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (looksLikeHeader(lines[i] ?? "") && looksLikeSeparator(lines[i + 1] ?? "")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const headerCells = parseRow(lines[headerIdx] ?? "");
  const columnOrder = headerCells.map((cell) => cell.trim().toLowerCase());
  // Accept either the canonical column order OR any reordering that
  // covers the expected set. Any missing expected column aborts parsing.
  const indexOf = (name: (typeof EXPECTED_COLUMNS)[number]): number =>
    columnOrder.indexOf(name);
  const indices: Record<(typeof EXPECTED_COLUMNS)[number], number> = {
    service_name: indexOf("service_name"),
    description: indexOf("description"),
    typical_data_inputs: indexOf("typical_data_inputs"),
    typical_analyst_question: indexOf("typical_analyst_question"),
    typical_deliverable: indexOf("typical_deliverable"),
  };
  for (const col of EXPECTED_COLUMNS) {
    if (indices[col] < 0) return [];
  }

  const entries: NiqServiceEntry[] = [];
  for (let i = headerIdx + 2; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line.trim()) break;
    if (!line.includes("|")) break;
    const cells = parseRow(line);
    if (cells.length !== columnOrder.length) continue;
    const serviceName = cells[indices.service_name]?.trim() ?? "";
    if (!serviceName) continue;
    entries.push({
      serviceName,
      description: cells[indices.description]?.trim() ?? "",
      typicalDataInputs: cells[indices.typical_data_inputs]?.trim() ?? "",
      typicalAnalystQuestion: cells[indices.typical_analyst_question]?.trim() ?? "",
      typicalDeliverable: cells[indices.typical_deliverable]?.trim() ?? "",
    });
  }
  return entries;
}

function looksLikeHeader(line: string): boolean {
  const lower = line.toLowerCase();
  return lower.includes("|") && lower.includes("service_name");
}

function looksLikeSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  // Any cell that is only hyphens/colons/spaces passes. At least one
  // cell must contain a hyphen.
  const cells = parseRow(trimmed);
  let sawHyphen = false;
  for (const cell of cells) {
    const t = cell.trim();
    if (!/^[-:\s]+$/.test(t)) return false;
    if (t.includes("-")) sawHyphen = true;
  }
  return sawHyphen;
}

function parseRow(line: string): string[] {
  // Split on unescaped pipes, then drop the empty cells that come from
  // a leading or trailing pipe. Preserves empty internal cells as "".
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|");
}
