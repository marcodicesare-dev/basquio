import { tool } from "ai";
import { z } from "zod";

import type { EvidenceWorkspace } from "@basquio/types";

// ─── TOOL CONTEXT ─────────────────────────────────────────────────
// All data exploration tools receive workspace + persistence context
// via closure when created. This keeps tools pure and testable.

export type ToolContext = {
  workspace: EvidenceWorkspace;
  runId: string;
  persistNotebookEntry: (entry: {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolOutput: Record<string, unknown>;
    evidenceRefId?: string;
  }) => Promise<string>; // returns entry ID
  /** Lazy row loader: fetches sheet data from Storage blobs on demand.
   *  Falls back to workspace.sheetData[key] for backward compat. */
  loadRows?: (sheetKey: string) => Promise<Record<string, unknown>[]>;
};

// ─── LIST FILES ───────────────────────────────────────────────────

export function createListFilesTool(ctx: ToolContext) {
  return tool({
    description: "List all files in the evidence workspace with metadata: name, type, sheets, row counts, column counts.",
    inputSchema: z.object({}),
    async execute() {
      const inventory = ctx.workspace.fileInventory.map((file) => ({
        id: file.id,
        fileName: file.fileName,
        kind: file.kind,
        role: file.role,
        sheets: file.sheets.map((s) => ({
          name: s.name,
          rowCount: s.rowCount,
          columnCount: s.columnCount,
        })),
        hasTextContent: Boolean(file.textContent),
      }));

      await ctx.persistNotebookEntry({
        toolName: "list_files",
        toolInput: {},
        toolOutput: { files: inventory },
      });

      return { files: inventory, fileCount: inventory.length };
    },
  });
}

// ─── DESCRIBE TABLE ───────────────────────────────────────────────

export function createDescribeTableTool(ctx: ToolContext) {
  return tool({
    description: "Get column metadata for a table: names, types, sample values, null rates, unique counts, inferred roles.",
    inputSchema: z.object({
      file: z.string().describe("File name from list_files"),
      sheet: z.string().optional().describe("Sheet name (optional if single sheet)"),
    }),
    async execute({ file, sheet }) {
      const fileEntry = ctx.workspace.fileInventory.find((f) => f.fileName === file || f.id === file);
      if (!fileEntry) {
        return { error: `File not found: ${file}`, columns: [] };
      }

      const targetSheet = sheet
        ? fileEntry.sheets.find((s) => s.name === sheet)
        : fileEntry.sheets[0];

      if (!targetSheet) {
        return {
          error: sheet ? `Sheet not found: ${sheet}` : "No sheets in file",
          availableSheets: fileEntry.sheets.map((s) => s.name),
          columns: [],
        };
      }

      const columns = targetSheet.columns.map((col) => ({
        name: col.name,
        type: col.inferredType,
        role: col.role,
        sampleValues: col.sampleValues.slice(0, 5),
        nullRate: col.nullRate,
        uniqueCount: col.uniqueCount,
        ...(col.uniqueCountApproximate ? { uniqueCountApproximate: true, uniqueCountNote: `≥${col.uniqueCount} (tracking capped at 1000 distinct values)` } : {}),
      }));

      await ctx.persistNotebookEntry({
        toolName: "describe_table",
        toolInput: { file, sheet },
        toolOutput: { file: fileEntry.fileName, sheet: targetSheet.name, columns, rowCount: targetSheet.rowCount },
      });

      return {
        file: fileEntry.fileName,
        sheet: targetSheet.name,
        rowCount: targetSheet.rowCount,
        columnCount: columns.length,
        columns,
      };
    },
  });
}

// ─── SAMPLE ROWS ──────────────────────────────────────────────────

export function createSampleRowsTool(ctx: ToolContext) {
  return tool({
    description: "Get a sample of rows from a table. Use to understand data shape before querying.",
    inputSchema: z.object({
      file: z.string().describe("File name"),
      sheet: z.string().optional().describe("Sheet name"),
      n: z.number().default(10).describe("Number of rows to sample (max 50)"),
    }),
    async execute({ file, sheet, n }) {
      const clampedN = Math.min(Math.max(n, 1), 50);
      const sheetKey = resolveSheetKey(ctx.workspace, file, sheet);
      if (!sheetKey) {
        return { error: `Cannot resolve sheet for file: ${file}`, rows: [] };
      }

      const rows = await resolveRows(ctx, sheetKey);
      const sample = rows.slice(0, clampedN);

      await ctx.persistNotebookEntry({
        toolName: "sample_rows",
        toolInput: { file, sheet, n: clampedN },
        toolOutput: { rowCount: rows.length, sampleCount: sample.length },
      });

      return { rows: sample, totalRows: rows.length, sampled: sample.length };
    },
  });
}

// ─── QUERY DATA ───────────────────────────────────────────────────

export function createQueryDataTool(ctx: ToolContext) {
  return tool({
    description:
      "Query the dataset. Supports filtering, grouping, aggregation, ordering. Returns max 100 rows. Use for specific data questions.",
    inputSchema: z.object({
      file: z.string().describe("File name"),
      sheet: z.string().optional(),
      columns: z.array(z.string()).describe("Columns to select"),
      filter: z.string().optional().describe('Filter expression, e.g. "region = North AND year > 2024"'),
      groupBy: z.array(z.string()).optional().describe("Columns to group by"),
      aggregate: z
        .object({
          column: z.string(),
          fn: z.enum(["sum", "avg", "count", "count_distinct", "min", "max", "ratio", "share"]),
        })
        .optional(),
      orderBy: z.string().optional().describe('e.g. "value DESC"'),
      limit: z.number().optional().default(100),
    }),
    async execute(params) {
      const sheetKey = resolveSheetKey(ctx.workspace, params.file, params.sheet);
      if (!sheetKey) {
        return { error: `Cannot resolve sheet for file: ${params.file}`, rows: [], rowCount: 0 };
      }

      let rows = await resolveRows(ctx, sheetKey);

      // Apply filter
      if (params.filter) {
        rows = applyFilter(rows, params.filter);
      }

      // Apply groupBy + aggregate
      if (params.groupBy && params.groupBy.length > 0 && params.aggregate) {
        rows = applyGroupByAggregate(rows, params.groupBy, params.aggregate);
      }

      // Apply ordering
      if (params.orderBy) {
        rows = applyOrderBy(rows, params.orderBy);
      }

      // Select columns
      const clampedLimit = Math.min(params.limit ?? 100, 100);
      const truncated = rows.length > clampedLimit;
      rows = rows.slice(0, clampedLimit);

      if (params.columns.length > 0 && !params.groupBy?.length) {
        rows = rows.map((row) => {
          const selected: Record<string, unknown> = {};
          for (const col of params.columns) {
            selected[col] = row[col];
          }
          return selected;
        });
      }

      const queryId = crypto.randomUUID();
      await ctx.persistNotebookEntry({
        toolName: "query_data",
        toolInput: params,
        toolOutput: { queryId, rowCount: rows.length, truncated },
      });

      return { rows, rowCount: rows.length, truncated, queryId };
    },
  });
}

// ─── COMPUTE METRIC ───────────────────────────────────────────────

export function createComputeMetricTool(ctx: ToolContext) {
  return tool({
    description:
      "Compute a named metric and register it as an evidence ref with a stable ID. Use for specific aggregations you want to cite in slides.",
    inputSchema: z.object({
      name: z.string().describe("Human-readable metric name"),
      description: z.string().describe("What this metric measures"),
      file: z.string(),
      sheet: z.string().optional(),
      column: z.string().describe("Column to aggregate"),
      aggregation: z.enum(["sum", "avg", "count", "count_distinct", "min", "max"]),
      groupBy: z.array(z.string()).optional(),
      filter: z.string().optional(),
    }),
    async execute(params) {
      const sheetKey = resolveSheetKey(ctx.workspace, params.file, params.sheet);
      if (!sheetKey) {
        return { error: `Cannot resolve sheet for file: ${params.file}` };
      }

      let rows = await resolveRows(ctx, sheetKey);

      if (params.filter) {
        rows = applyFilter(rows, params.filter);
      }

      const metricId = `metric-${crypto.randomUUID().slice(0, 8)}`;

      if (params.groupBy && params.groupBy.length > 0) {
        const grouped = applyGroupByAggregate(rows, params.groupBy, {
          column: params.column,
          fn: params.aggregation,
        });

        const evidenceRefId = `ev-${metricId}`;
        await ctx.persistNotebookEntry({
          toolName: "compute_metric",
          toolInput: params,
          toolOutput: {
            metricId,
            breakdown: grouped.slice(0, 50),
            evidenceRef: evidenceRefId,
          },
          evidenceRefId,
        });

        return {
          metricId,
          name: params.name,
          breakdown: grouped.slice(0, 50),
          evidenceRef: evidenceRefId,
        };
      }

      const value = computeAggregate(rows, params.column, params.aggregation);
      const evidenceRefId = `ev-${metricId}`;

      await ctx.persistNotebookEntry({
        toolName: "compute_metric",
        toolInput: params,
        toolOutput: { metricId, value, evidenceRef: evidenceRefId },
        evidenceRefId,
      });

      return { metricId, name: params.name, value, evidenceRef: evidenceRefId };
    },
  });
}

// ─── COMPUTE DERIVED METRIC ──────────────────────────────────────
// Cross-column derived metrics: price, share, growth, index, etc.

export function createComputeDerivedTool(ctx: ToolContext) {
  return tool({
    description:
      "Compute a derived cross-column metric: price (value/units), market share, growth rate, index, contribution, mix gap. Use this for any metric that requires dividing or comparing two columns or two filtered subsets.",
    inputSchema: z.object({
      name: z.string().describe("Human-readable metric name, e.g. 'Ultima price per unit'"),
      description: z.string().describe("What this measures and why it matters"),
      file: z.string(),
      sheet: z.string().optional(),
      formula: z.enum([
        "ratio",        // numeratorColumn / denominatorColumn
        "per_unit",     // same as ratio, for price = value / units
        "share",        // entity value / total value (value-based)
        "growth_rate",  // (current - prior) / prior
        "index",        // (entity value / category average) * 100
        "contribution", // entity abs change / total abs change
        "mix_gap",      // share(col1) - share(col2) per entity
        "difference",   // sum(colA) - sum(colB) per group
      ]),
      numeratorColumn: z.string().optional().describe("Column for numerator (ratio/per_unit/difference)"),
      denominatorColumn: z.string().optional().describe("Column for denominator (ratio/per_unit)"),
      valueColumn: z.string().optional().describe("Primary value column (share/growth_rate/index/contribution)"),
      secondValueColumn: z.string().optional().describe("Second value column (mix_gap: volume column; difference: column B)"),
      currentFilter: z.string().optional().describe('Filter for current period, e.g. "Year = 2025"'),
      priorFilter: z.string().optional().describe('Filter for prior period, e.g. "Year = 2024"'),
      entityFilter: z.string().optional().describe('Filter to isolate entity, e.g. "Brand = Ultima"'),
      groupBy: z.array(z.string()).optional(),
      filter: z.string().optional().describe("Global filter applied before computation"),
    }),
    async execute(params) {
      const sheetKey = resolveSheetKey(ctx.workspace, params.file, params.sheet);
      if (!sheetKey) return { error: `Cannot resolve sheet for file: ${params.file}` };

      let rows = await resolveRows(ctx, sheetKey);
      if (params.filter) rows = applyFilter(rows, params.filter);
      if (rows.length === 0) return { error: "No rows match the filter criteria" };

      const metricId = `derived-${crypto.randomUUID().slice(0, 8)}`;
      let result: Record<string, unknown>;

      try {
        switch (params.formula) {
          case "ratio":
          case "per_unit": {
            if (!params.numeratorColumn || !params.denominatorColumn) {
              return { error: `${params.formula} requires numeratorColumn and denominatorColumn` };
            }
            if (params.groupBy && params.groupBy.length > 0) {
              const groups = groupRowsBy(rows, params.groupBy);
              const breakdown = Object.entries(groups).map(([key, groupRows]) => {
                const num = sumCol(groupRows, params.numeratorColumn!);
                const den = sumCol(groupRows, params.denominatorColumn!);
                return { group: key, value: den !== 0 ? round(num / den) : null, numerator: round(num), denominator: round(den) };
              }).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
              result = { formula: params.formula, breakdown: breakdown.slice(0, 30) };
            } else {
              const num = sumCol(rows, params.numeratorColumn);
              const den = sumCol(rows, params.denominatorColumn);
              result = { formula: params.formula, value: den !== 0 ? round(num / den) : null, numerator: round(num), denominator: round(den) };
            }
            break;
          }

          case "share": {
            if (!params.valueColumn) return { error: "share requires valueColumn" };
            const totalValue = sumCol(rows, params.valueColumn);
            if (totalValue === 0) return { error: "Total value is zero — cannot compute share" };

            if (params.entityFilter) {
              const entityRows = applyFilter(rows, params.entityFilter);
              const entityValue = sumCol(entityRows, params.valueColumn);
              result = { formula: "share", value: round((entityValue / totalValue) * 100), entityValue: round(entityValue), totalValue: round(totalValue), unit: "%" };
            } else if (params.groupBy && params.groupBy.length > 0) {
              const groups = groupRowsBy(rows, params.groupBy);
              const breakdown = Object.entries(groups).map(([key, groupRows]) => {
                const val = sumCol(groupRows, params.valueColumn!);
                return { group: key, value: round((val / totalValue) * 100), absoluteValue: round(val) };
              }).sort((a, b) => b.value - a.value);
              result = { formula: "share", breakdown: breakdown.slice(0, 30), totalValue: round(totalValue), unit: "%" };
            } else {
              return { error: "share requires either entityFilter or groupBy" };
            }
            break;
          }

          case "growth_rate": {
            if (!params.valueColumn || !params.currentFilter || !params.priorFilter) {
              return { error: "growth_rate requires valueColumn, currentFilter, and priorFilter" };
            }
            const compute = (subset: Record<string, unknown>[]) => {
              const current = sumCol(applyFilter(subset, params.currentFilter!), params.valueColumn!);
              const prior = sumCol(applyFilter(subset, params.priorFilter!), params.valueColumn!);
              return { current: round(current), prior: round(prior), growth: prior !== 0 ? round(((current - prior) / prior) * 100) : null };
            };

            if (params.groupBy && params.groupBy.length > 0) {
              const groups = groupRowsBy(rows, params.groupBy);
              const breakdown = Object.entries(groups).map(([key, groupRows]) => ({
                group: key, ...compute(groupRows),
              })).sort((a, b) => (b.growth ?? 0) - (a.growth ?? 0));
              result = { formula: "growth_rate", breakdown: breakdown.slice(0, 30), unit: "%" };
            } else {
              result = { formula: "growth_rate", ...compute(rows), unit: "%" };
            }
            break;
          }

          case "index": {
            if (!params.valueColumn || !params.entityFilter) {
              return { error: "index requires valueColumn and entityFilter" };
            }
            const entityRows = applyFilter(rows, params.entityFilter);
            const entityAvg = sumCol(entityRows, params.valueColumn) / (entityRows.length || 1);
            const categoryAvg = sumCol(rows, params.valueColumn) / (rows.length || 1);
            result = { formula: "index", value: categoryAvg !== 0 ? round((entityAvg / categoryAvg) * 100) : null, entityAvg: round(entityAvg), categoryAvg: round(categoryAvg) };
            break;
          }

          case "contribution": {
            if (!params.valueColumn || !params.currentFilter || !params.priorFilter || !params.entityFilter) {
              return { error: "contribution requires valueColumn, currentFilter, priorFilter, and entityFilter" };
            }
            const entityCurrent = sumCol(applyFilter(applyFilter(rows, params.entityFilter), params.currentFilter), params.valueColumn);
            const entityPrior = sumCol(applyFilter(applyFilter(rows, params.entityFilter), params.priorFilter), params.valueColumn);
            const totalCurrent = sumCol(applyFilter(rows, params.currentFilter), params.valueColumn);
            const totalPrior = sumCol(applyFilter(rows, params.priorFilter), params.valueColumn);
            const totalChange = totalCurrent - totalPrior;
            const entityChange = entityCurrent - entityPrior;
            result = {
              formula: "contribution",
              value: totalChange !== 0 ? round((entityChange / totalChange) * 100) : null,
              entityChange: round(entityChange), totalChange: round(totalChange), unit: "%",
            };
            break;
          }

          case "mix_gap": {
            if (!params.valueColumn || !params.secondValueColumn) {
              return { error: "mix_gap requires valueColumn (value) and secondValueColumn (volume)" };
            }
            const totalVal = sumCol(rows, params.valueColumn);
            const totalVol = sumCol(rows, params.secondValueColumn);
            if (totalVal === 0 || totalVol === 0) return { error: "Total value or volume is zero" };

            if (params.groupBy && params.groupBy.length > 0) {
              const groups = groupRowsBy(rows, params.groupBy);
              const breakdown = Object.entries(groups).map(([key, groupRows]) => {
                const valShare = (sumCol(groupRows, params.valueColumn!) / totalVal) * 100;
                const volShare = (sumCol(groupRows, params.secondValueColumn!) / totalVol) * 100;
                return { group: key, valueShare: round(valShare), volumeShare: round(volShare), mixGap: round(valShare - volShare) };
              }).sort((a, b) => b.mixGap - a.mixGap);
              result = { formula: "mix_gap", breakdown: breakdown.slice(0, 30), unit: "pp" };
            } else if (params.entityFilter) {
              const entityRows = applyFilter(rows, params.entityFilter);
              const valShare = (sumCol(entityRows, params.valueColumn) / totalVal) * 100;
              const volShare = (sumCol(entityRows, params.secondValueColumn) / totalVol) * 100;
              result = { formula: "mix_gap", valueShare: round(valShare), volumeShare: round(volShare), mixGap: round(valShare - volShare), unit: "pp" };
            } else {
              return { error: "mix_gap requires groupBy or entityFilter" };
            }
            break;
          }

          case "difference": {
            if (!params.numeratorColumn || !params.secondValueColumn) {
              return { error: "difference requires numeratorColumn (column A) and secondValueColumn (column B)" };
            }
            if (params.groupBy && params.groupBy.length > 0) {
              const groups = groupRowsBy(rows, params.groupBy);
              const breakdown = Object.entries(groups).map(([key, groupRows]) => {
                const a = sumCol(groupRows, params.numeratorColumn!);
                const b = sumCol(groupRows, params.secondValueColumn!);
                return { group: key, value: round(a - b), columnA: round(a), columnB: round(b) };
              }).sort((a, b) => b.value - a.value);
              result = { formula: "difference", breakdown: breakdown.slice(0, 30) };
            } else {
              const a = sumCol(rows, params.numeratorColumn);
              const b = sumCol(rows, params.secondValueColumn);
              result = { formula: "difference", value: round(a - b), columnA: round(a), columnB: round(b) };
            }
            break;
          }

          default:
            return { error: `Unknown formula: ${params.formula}` };
        }
      } catch (err) {
        return { error: `Computation failed: ${err instanceof Error ? err.message : String(err)}` };
      }

      const evidenceRefId = `ev-${metricId}`;
      await ctx.persistNotebookEntry({
        toolName: "compute_derived",
        toolInput: params,
        toolOutput: { metricId, ...result, evidenceRef: evidenceRefId },
        evidenceRefId,
      });

      return { metricId, name: params.name, description: params.description, ...result, evidenceRef: evidenceRefId };
    },
  });
}

// ─── DERIVED METRIC HELPERS ──────────────────────────────────────

function sumCol(rows: Record<string, unknown>[], column: string): number {
  return rows.reduce((total, row) => {
    const val = row[column];
    const num = typeof val === "number" ? val : typeof val === "string" ? parseFloat(val) : NaN;
    return total + (isNaN(num) ? 0 : num);
  }, 0);
}

function groupRowsBy(rows: Record<string, unknown>[], keys: string[]): Record<string, Record<string, unknown>[]> {
  const groups: Record<string, Record<string, unknown>[]> = {};
  for (const row of rows) {
    const key = keys.map((k) => String(row[k] ?? "")).join(" | ");
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }
  return groups;
}

// ─── READ SUPPORT DOC ─────────────────────────────────────────────

export function createReadSupportDocTool(ctx: ToolContext) {
  return tool({
    description: "Read text content from a support document (PDF, DOCX, methodology guide, etc.). Use the pages parameter to read specific pages of a PDF or specific slides of a PPTX.",
    inputSchema: z.object({
      file: z.string().describe("File name or ID"),
      pages: z.string().optional().describe('Page/slide range, e.g. "1-5", "7", "3,5,9". Returns only those pages.'),
    }),
    async execute({ file, pages }) {
      const fileEntry = ctx.workspace.fileInventory.find((f) => f.fileName === file || f.id === file);
      if (!fileEntry) {
        return { error: `File not found: ${file}`, text: "" };
      }

      // If pages are specified and we have page-level data, return only those pages
      const filePages = (fileEntry as Record<string, unknown>).pages as Array<{ num: number; text: string }> | undefined;
      if (pages && filePages && filePages.length > 0) {
        const requestedNums = parsePageRange(pages);
        const matchedPages = filePages.filter((p) => requestedNums.has(p.num));
        if (matchedPages.length === 0) {
          return {
            error: `No pages matched range "${pages}". Available pages: ${filePages.map((p) => p.num).join(", ")}`,
            text: "",
            availablePages: filePages.map((p) => p.num),
          };
        }

        const text = matchedPages.map((p) => `[Page ${p.num}]\n${p.text}`).join("\n\n");
        const truncated = text.length > 20_000;

        await ctx.persistNotebookEntry({
          toolName: "read_support_doc",
          toolInput: { file, pages },
          toolOutput: { fileName: fileEntry.fileName, pagesRead: matchedPages.map((p) => p.num), charCount: Math.min(text.length, 20_000) },
        });

        return {
          fileName: fileEntry.fileName,
          text: truncated ? text.slice(0, 20_000) : text,
          truncated,
          pagesRead: matchedPages.map((p) => p.num),
          totalPages: filePages.length,
        };
      }

      if (!fileEntry.textContent) {
        return {
          error: `No text content extracted for: ${file}. This file may be a workbook — use describe_table and sample_rows instead.`,
          text: "",
          ...(filePages ? { availablePages: filePages.map((p) => p.num), hint: "Use the pages parameter to read specific pages." } : {}),
        };
      }

      // Full text, truncated to prevent context window explosion
      const text = fileEntry.textContent.slice(0, 20_000);
      const truncated = fileEntry.textContent.length > 20_000;

      await ctx.persistNotebookEntry({
        toolName: "read_support_doc",
        toolInput: { file },
        toolOutput: { fileName: fileEntry.fileName, charCount: text.length, truncated },
      });

      return {
        fileName: fileEntry.fileName,
        text,
        truncated,
        ...(filePages ? { pageCount: filePages.length, hint: `This file has ${filePages.length} pages. Use pages parameter for specific pages.` } : {}),
      };
    },
  });
}

function parsePageRange(range: string): Set<number> {
  const nums = new Set<number>();
  for (const part of range.split(",")) {
    const trimmed = part.trim();
    const dashMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (dashMatch) {
      const start = parseInt(dashMatch[1], 10);
      const end = parseInt(dashMatch[2], 10);
      for (let i = start; i <= end && i <= start + 100; i++) {
        nums.add(i);
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num)) nums.add(num);
    }
  }
  return nums;
}

// ─── HELPERS ──────────────────────────────────────────────────────

/** Resolve rows for a sheet: uses lazy loader if available, falls back to in-memory sheetData */
async function resolveRows(ctx: ToolContext, sheetKey: string): Promise<Record<string, unknown>[]> {
  if (ctx.loadRows) {
    return ctx.loadRows(sheetKey);
  }
  return ctx.workspace.sheetData[sheetKey] ?? [];
}

function resolveSheetKey(
  workspace: EvidenceWorkspace,
  file: string,
  sheet?: string,
): string | null {
  const fileEntry = workspace.fileInventory.find((f) => f.fileName === file || f.id === file);
  if (!fileEntry) return null;

  const targetSheet = sheet
    ? fileEntry.sheets.find((s) => s.name === sheet)
    : fileEntry.sheets[0];

  if (!targetSheet) return null;

  // Construct the canonical key: "<fileId>:<sheetName>"
  // This matches the key format used by streamParseFile in data-ingest.
  // Don't rely on workspace.sheetData for key validation — in v2,
  // sheetData is {} and rows live in Storage blobs loaded via loadRows().
  const canonicalKey = `${fileEntry.id}:${targetSheet.name}`;

  // If sheetData has entries (v1 compat), verify the key exists there
  const sheetDataKeys = Object.keys(workspace.sheetData);
  if (sheetDataKeys.length > 0) {
    if (workspace.sheetData[canonicalKey]) return canonicalKey;
    const key2 = `${fileEntry.fileName}:${targetSheet.name}`;
    if (workspace.sheetData[key2]) return key2;
    const matchingKey = sheetDataKeys.find(
      (k) => k.endsWith(`:${targetSheet.name}`) && (k.startsWith(fileEntry.id) || k.startsWith(fileEntry.fileName)),
    );
    return matchingKey ?? null;
  }

  // v2 path: sheetData is empty, return canonical key for loadRows()
  return canonicalKey;
}

function applyFilter(rows: Record<string, unknown>[], filterExpr: string): Record<string, unknown>[] {
  // Parse simple filter expressions: "column = value AND column > value"
  const conditions = filterExpr.split(/\s+AND\s+/i);

  return rows.filter((row) =>
    conditions.every((condition) => {
      const match = condition.trim().match(/^"?(.+?)"?\s*(=|!=|<>|>|>=|<|<=|LIKE|IN)\s*(.+)$/i);
      if (!match) return false; // unparseable → exclude (fail safe, not fail open)

      const [, col, op, rawVal] = match;
      const rowVal = row[col.trim()];
      const val = rawVal.trim().replace(/^['"]|['"]$/g, "");

      switch (op.toUpperCase()) {
        case "=":
          return String(rowVal) === val;
        case "!=":
        case "<>":
          return String(rowVal) !== val;
        case ">":
          return Number(rowVal) > Number(val);
        case ">=":
          return Number(rowVal) >= Number(val);
        case "<":
          return Number(rowVal) < Number(val);
        case "<=":
          return Number(rowVal) <= Number(val);
        case "LIKE":
          return String(rowVal).includes(val.replace(/%/g, ""));
        default:
          return true;
      }
    }),
  );
}

function applyGroupByAggregate(
  rows: Record<string, unknown>[],
  groupBy: string[],
  aggregate: { column: string; fn: string },
): Record<string, unknown>[] {
  const groups = new Map<string, Record<string, unknown>[]>();

  for (const row of rows) {
    const key = groupBy.map((col) => String(row[col] ?? "")).join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // For share/ratio, compute the global total first
  let globalTotal: number | undefined;
  if (aggregate.fn === "share" || aggregate.fn === "ratio") {
    globalTotal = rows
      .map((r) => Number(r[aggregate.column]))
      .filter((v) => !isNaN(v))
      .reduce((a, b) => a + b, 0);
  }

  return Array.from(groups.entries()).map(([, groupRows]) => {
    const result: Record<string, unknown> = {};
    for (const col of groupBy) {
      result[col] = groupRows[0][col];
    }
    result[`${aggregate.fn}_${aggregate.column}`] = computeAggregate(
      groupRows,
      aggregate.column,
      aggregate.fn,
      globalTotal,
    );
    result._count = groupRows.length;
    return result;
  });
}

function computeAggregate(
  rows: Record<string, unknown>[],
  column: string,
  fn: string,
  globalTotal?: number,
): number | string {
  const values = rows
    .map((r) => Number(r[column]))
    .filter((v) => !isNaN(v));

  if (values.length === 0) return 0;

  switch (fn) {
    case "sum":
      return round(values.reduce((a, b) => a + b, 0));
    case "avg":
      return round(values.reduce((a, b) => a + b, 0) / values.length);
    case "count":
      return rows.length;
    case "count_distinct": {
      const unique = new Set(rows.map((r) => String(r[column])));
      return unique.size;
    }
    case "min":
      return round(Math.min(...values));
    case "max":
      return round(Math.max(...values));
    case "ratio": {
      // Group sum / global total — requires globalTotal from grouped context
      const groupSum = values.reduce((a, b) => a + b, 0);
      if (globalTotal === undefined || globalTotal === 0) return 0;
      return round(groupSum / globalTotal);
    }
    case "share": {
      // Group sum / global total — each group's proportion of the whole
      const groupSum = values.reduce((a, b) => a + b, 0);
      if (globalTotal === undefined || globalTotal === 0) return 0;
      return round(groupSum / globalTotal);
    }
    default:
      return 0;
  }
}

function round(value: number, decimals = 4): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function applyOrderBy(rows: Record<string, unknown>[], orderBy: string): Record<string, unknown>[] {
  const match = orderBy.match(/^(.+?)\s*(ASC|DESC)?$/i);
  if (!match) return rows;

  const [, col, dir] = match;
  const direction = dir?.toUpperCase() === "DESC" ? -1 : 1;

  return [...rows].sort((a, b) => {
    const aVal = a[col.trim()];
    const bVal = b[col.trim()];
    if (typeof aVal === "number" && typeof bVal === "number") {
      return (aVal - bVal) * direction;
    }
    return String(aVal ?? "").localeCompare(String(bVal ?? "")) * direction;
  });
}
