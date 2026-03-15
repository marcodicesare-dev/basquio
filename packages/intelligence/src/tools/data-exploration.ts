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

      const rows = ctx.workspace.sheetData[sheetKey] ?? [];
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

      let rows = ctx.workspace.sheetData[sheetKey] ?? [];

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

      let rows = ctx.workspace.sheetData[sheetKey] ?? [];

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

// ─── READ SUPPORT DOC ─────────────────────────────────────────────

export function createReadSupportDocTool(ctx: ToolContext) {
  return tool({
    description: "Read text content from a support document (PDF, DOCX, methodology guide, definitions, etc.).",
    inputSchema: z.object({
      file: z.string().describe("File name or ID"),
      pages: z.string().optional().describe('Page range for PDFs, e.g. "1-5"'),
    }),
    async execute({ file, pages }) {
      const fileEntry = ctx.workspace.fileInventory.find((f) => f.fileName === file || f.id === file);
      if (!fileEntry) {
        return { error: `File not found: ${file}`, text: "" };
      }

      if (!fileEntry.textContent) {
        return {
          error: `No text content extracted for: ${file}. This file may be a workbook — use describe_table and sample_rows instead.`,
          text: "",
        };
      }

      // Truncate to prevent context window explosion
      const text = fileEntry.textContent.slice(0, 20_000);
      const truncated = fileEntry.textContent.length > 20_000;

      await ctx.persistNotebookEntry({
        toolName: "read_support_doc",
        toolInput: { file },
        toolOutput: { fileName: fileEntry.fileName, charCount: text.length, truncated },
      });

      return { fileName: fileEntry.fileName, text, truncated };
    },
  });
}

// ─── HELPERS ──────────────────────────────────────────────────────

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

  // Try both key formats
  const key1 = `${fileEntry.id}:${targetSheet.name}`;
  const key2 = `${fileEntry.fileName}:${targetSheet.name}`;

  if (workspace.sheetData[key1]) return key1;
  if (workspace.sheetData[key2]) return key2;

  // Fallback: find any key containing the sheet name
  const matchingKey = Object.keys(workspace.sheetData).find(
    (k) => k.endsWith(`:${targetSheet.name}`) && (k.startsWith(fileEntry.id) || k.startsWith(fileEntry.fileName)),
  );

  return matchingKey ?? null;
}

function applyFilter(rows: Record<string, unknown>[], filterExpr: string): Record<string, unknown>[] {
  // Parse simple filter expressions: "column = value AND column > value"
  const conditions = filterExpr.split(/\s+AND\s+/i);

  return rows.filter((row) =>
    conditions.every((condition) => {
      const match = condition.trim().match(/^"?(.+?)"?\s*(=|!=|<>|>|>=|<|<=|LIKE|IN)\s*(.+)$/i);
      if (!match) return true; // unparseable → include

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

  return Array.from(groups.entries()).map(([, groupRows]) => {
    const result: Record<string, unknown> = {};
    for (const col of groupBy) {
      result[col] = groupRows[0][col];
    }
    result[`${aggregate.fn}_${aggregate.column}`] = computeAggregate(
      groupRows,
      aggregate.column,
      aggregate.fn,
    );
    result._count = groupRows.length;
    return result;
  });
}

function computeAggregate(
  rows: Record<string, unknown>[],
  column: string,
  fn: string,
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
      // Ratio of first value to total
      if (values.length < 2) return 0;
      const total = values.reduce((a, b) => a + b, 0);
      return total === 0 ? 0 : round(values[0] / total);
    }
    case "share": {
      // Each value's share of total (returns average share)
      const shareTotal = values.reduce((a, b) => a + b, 0);
      return shareTotal === 0 ? 0 : round(1 / values.length);
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
