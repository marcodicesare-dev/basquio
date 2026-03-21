import {
  analyticsResultSchema,
  computedMetricSchema,
  derivedTableSchema,
  executableMetricSpecSchema,
  type AnalyticsResult,
  type ComputedMetric,
  type DatasetProfile,
  type EvidenceRef,
  type ExecutableMetricSpec,
  type NormalizedWorkbook,
  type PackageSemantics,
} from "@basquio/types";

import { buildEvidenceId, compactUnique, round } from "./utils";

type ComputeAnalyticsInput = {
  datasetProfile: DatasetProfile;
  workbook: NormalizedWorkbook;
  packageSemantics: PackageSemantics;
  metricPlan?: ExecutableMetricSpec[];
  onHeartbeat?: () => Promise<void> | void;
};

type JoinedRow = Record<string, unknown>;
type AnalyticsHeartbeat = {
  tick: () => Promise<void>;
};

export async function computeAnalytics(input: ComputeAnalyticsInput): Promise<AnalyticsResult> {
  const executableSpecs = buildExecutableMetricSpecs(input.packageSemantics, input.datasetProfile, input.metricPlan);
  const heartbeat = createAnalyticsHeartbeat(input.onHeartbeat);
  const evidenceRefs: EvidenceRef[] = [];
  const derivedTables: AnalyticsResult["derivedTables"] = [];
  const metrics: ComputedMetric[] = [];
  const rankings: AnalyticsResult["rankings"] = [];
  const deltas: AnalyticsResult["deltas"] = [];

  for (const spec of executableSpecs) {
    await heartbeat.tick();
    const rows = await resolveMetricRows(spec, input.workbook, input.packageSemantics, heartbeat);

    if (rows.length === 0) {
      continue;
    }

    const metricResult = await executeMetric(spec, rows, input.workbook, evidenceRefs, derivedTables, heartbeat);
    metrics.push(metricResult.metric);
    if (metricResult.ranking) {
      rankings.push(metricResult.ranking);
    }
    if (metricResult.delta) {
      deltas.push(metricResult.delta);
    }
  }

  const distributions = buildDistributions(metrics, derivedTables);
  const outliers = buildOutliers(derivedTables);
  const correlations = buildCorrelations(derivedTables);
  const segmentBreakdowns = buildSegmentBreakdowns(derivedTables);

  return analyticsResultSchema.parse({
    metrics,
    correlations,
    rankings,
    deltas,
    distributions,
    outliers,
    segmentBreakdowns,
    derivedTables,
    evidenceRefs,
  });
}

export function buildExecutableMetricSpecs(
  packageSemantics: PackageSemantics,
  datasetProfile: DatasetProfile,
  metricPlan?: ExecutableMetricSpec[],
) {
  const specs =
    metricPlan && metricPlan.length > 0
      ? metricPlan
      : packageSemantics.candidateMetrics
          .map((metric, index) => metric.executableSpec ?? translateMetric(metric.name, metric.formula, metric.sourceFiles[0], datasetProfile, index))
          .filter((spec): spec is ExecutableMetricSpec => Boolean(spec));

  return specs.map((spec) => executableMetricSpecSchema.parse(spec));
}

function translateMetric(
  name: string,
  formula: string,
  sourceFile: string,
  datasetProfile: DatasetProfile,
  index: number,
): ExecutableMetricSpec | null {
  const normalized = formula.toLowerCase();
  const groupBy = extractGroupBy(formula);
  const sourceSheet = datasetProfile.sheets.find((sheet) => sheet.sourceFileName === sourceFile);
  const timeColumn = sourceSheet?.columns.find((column) => column.role === "time")?.name;

  if (normalized.startsWith("average ")) {
    const valueColumn = formula.match(/average(?: of)?\s+"?(.+?)"?(?:\s+grouped by|$)/i)?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (!valueColumn) {
      return null;
    }

    return {
      id: `${slugify(name)}-${index}`,
      name,
      type: "average",
      sourceFile,
      groupBy,
      valueColumn,
      filter: [],
      joinFiles: [],
      joins: [],
      timeColumn,
    };
  }

  if (normalized.startsWith("sum ")) {
    const valueColumn = formula.match(/sum(?: of)?\s+"?(.+?)"?(?:\s+grouped by|$)/i)?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (!valueColumn) {
      return null;
    }

    return {
      id: `${slugify(name)}-${index}`,
      name,
      type: "sum",
      sourceFile,
      groupBy,
      valueColumn,
      filter: [],
      joinFiles: [],
      joins: [],
      timeColumn,
    };
  }

  if (normalized.startsWith("count distinct ")) {
    const valueColumn = formula.match(/count distinct\s+"?(.+?)"?(?:$|\s+grouped by)/i)?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (!valueColumn) {
      return null;
    }

    return {
      id: `${slugify(name)}-${index}`,
      name,
      type: "count_distinct",
      sourceFile,
      groupBy,
      valueColumn,
      filter: [],
      joinFiles: [],
      joins: [],
      timeColumn,
    };
  }

  if (normalized.includes("count rows where") && (normalized.includes("/ total rows") || normalized.includes("divided by total rows"))) {
    const filterMatch = formula.match(/count rows where\s+"?(.+?)"?\s*=\s*(.+?)\s*(?:\/|divided by)\s*total rows/i);
    if (!filterMatch) {
      return null;
    }

    return {
      id: `${slugify(name)}-${index}`,
      name,
      type: "ratio",
      sourceFile,
      groupBy,
      filter: [],
      joinFiles: [],
      joins: [],
      numerator: {
        aggregation: "count",
        filter: [
          {
            column: filterMatch[1].trim(),
            operator: "eq",
            value: parseFilterValue(filterMatch[2].trim()),
          },
        ],
      },
      denominator: {
        aggregation: "count",
        filter: [],
      },
      timeColumn,
    };
  }

  if (normalized.startsWith("delta over ")) {
    return {
      id: `${slugify(name)}-${index}`,
      name,
      type: "delta",
      sourceFile,
      groupBy: [],
      filter: [],
      joinFiles: [],
      joins: [],
      timeColumn,
      valueColumn: sourceSheet?.columns.find((column) => column.role === "measure")?.name,
    };
  }

  return null;
}

function extractGroupBy(formula: string) {
  const groupMatch = formula.match(/grouped by\s+(.+)$/i)?.[1];
  if (!groupMatch) {
    return [];
  }

  return groupMatch
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

async function resolveMetricRows(
  spec: ExecutableMetricSpec,
  workbook: NormalizedWorkbook,
  packageSemantics: PackageSemantics,
  heartbeat: AnalyticsHeartbeat,
) {
  const baseSheet = workbook.sheets.find((sheet) => sheet.sourceFileName === spec.sourceFile);
  if (!baseSheet) {
    return [];
  }

  let rows = baseSheet.rows.map((row) => prefixKeys(row, baseSheet.sourceFileName));
  const joinTargets = spec.joinFiles.length === 0
    ? []
    : packageSemantics.relationships.filter((relationship) => {
    const touchesSource = relationship.fromFile === spec.sourceFile || relationship.toFile === spec.sourceFile;
    if (!touchesSource) {
      return false;
    }

    const otherFile = relationship.fromFile === spec.sourceFile ? relationship.toFile : relationship.fromFile;
    return spec.joinFiles.includes(otherFile);
  });

  const explicitJoins = spec.joins.length > 0
    ? spec.joins
    : joinTargets.map((relationship) => ({
        file: relationship.fromFile === spec.sourceFile ? relationship.toFile : relationship.fromFile,
        leftKey: relationship.fromFile === spec.sourceFile ? relationship.leftKey : relationship.rightKey,
        rightKey: relationship.fromFile === spec.sourceFile ? relationship.rightKey : relationship.leftKey,
      }));

  for (const joinTarget of explicitJoins) {
    await heartbeat.tick();
    const otherFile = joinTarget.file;
    const otherSheet = workbook.sheets.find((sheet) => sheet.sourceFileName === otherFile);

    if (!otherSheet) {
      continue;
    }

    rows = await innerJoinRows(rows, otherSheet.rows, joinTarget.leftKey, joinTarget.rightKey, otherFile, heartbeat);
  }

  return applyFilters(rows, spec.filter);
}

async function executeMetric(
  spec: ExecutableMetricSpec,
  rows: JoinedRow[],
  workbook: NormalizedWorkbook,
  evidenceRefs: EvidenceRef[],
  derivedTables: AnalyticsResult["derivedTables"],
  heartbeat: AnalyticsHeartbeat,
) {
  const groupedRows = await groupRows(rows, spec.groupBy, heartbeat);
  const totalRowCount = rows.length;
  const tableRows = groupedRows.map((group) => {
    const value = computeGroupValue(spec, group.rows, totalRowCount);
    return {
      key: group.key,
      value,
      count: group.rows.length,
    };
  });
  const orderedRows = applySortAndLimit(tableRows, spec);
  const overallValue = computeGroupValue(spec, rows, totalRowCount);
  const tableValues = orderedRows.map((row) => row.value);
  const stddev = computeStddev(tableValues);
  const evidenceRefIds = orderedRows.map((row, index) => {
    const sheet = workbook.sheets.find((candidate) => candidate.sourceFileName === spec.sourceFile);
    const evidenceId = buildEvidenceId({
      sourceFileId: sheet?.sourceFileId,
      fileName: spec.sourceFile,
      sheet: sheet?.name ?? spec.sourceFile,
      metric: spec.name,
      suffix: `${row.key}-${index}`,
    });

    evidenceRefs.push({
      id: evidenceId,
      sourceFileId: sheet?.sourceFileId ?? "",
      fileName: spec.sourceFile,
      fileRole: sheet?.sourceRole ?? "unknown-support",
      sheet: sheet?.name ?? spec.sourceFile,
      metric: spec.name,
      summary: `${spec.name} for ${row.key} is ${round(row.value)} across ${row.count} contributing rows.`,
      confidence: computeEvidenceConfidence(
        spec,
        groupedRows.find((group) => group.key === row.key)?.rows ?? [],
        rows,
      ),
      sourceLocation: `${sheet?.name ?? spec.sourceFile}.${spec.name}`,
      rawValue: row.value,
      derivedTable: `${spec.name}_table`,
      dimensions: groupDimensions(spec.groupBy, row.key),
    });

    return evidenceId;
  });

  const derivedTable = derivedTableSchema.parse({
    name: `${spec.name}_table`,
    description: `Materialized output for ${spec.name}.`,
    columns: compactUnique(["key", "value", "count"]),
    rows: orderedRows,
  });
  derivedTables.push(derivedTable);

  const metric = computedMetricSchema.parse({
    name: spec.name,
    metricType: spec.type,
    overallValue,
    stddev,
    sampleSize: rows.length,
    byDimension: {
      [spec.groupBy.join("_") || "overall"]: orderedRows.map((row) => ({
        key: row.key,
        value: row.value,
      })),
    },
    evidenceRefIds,
  });

  const ranking =
    orderedRows.length > 1
      ? {
          dimension: spec.groupBy.join("_") || "overall",
          metric: spec.name,
          order: orderedRows
            .slice()
            .sort((left, right) => right.value - left.value)
            .map((row) => ({ key: row.key, value: row.value })),
        }
      : undefined;

  const delta =
    spec.type === "delta" && orderedRows.length >= 2
      ? {
          metric: spec.name,
          period1: String(orderedRows[orderedRows.length - 2]?.key ?? "period_1"),
          period2: String(orderedRows[orderedRows.length - 1]?.key ?? "period_2"),
          absoluteChange: (orderedRows[orderedRows.length - 1]?.value ?? 0) - (orderedRows[orderedRows.length - 2]?.value ?? 0),
          pctChange:
            orderedRows[orderedRows.length - 2]?.value
              ? ((orderedRows[orderedRows.length - 1]?.value ?? 0) - (orderedRows[orderedRows.length - 2]?.value ?? 0)) /
                orderedRows[orderedRows.length - 2].value
              : 0,
        }
      : undefined;

  return {
    metric,
    ranking,
    delta,
  };
}

function computeGroupValue(spec: ExecutableMetricSpec, rows: JoinedRow[], totalRowCount: number) {
  if (spec.type === "average") {
    const values = rows.map((row) => coerceNumber(resolveValue(row, spec.valueColumn))).filter((value): value is number => value !== null);
    return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : 0;
  }

  if (spec.type === "sum") {
    return rows.reduce((total, row) => total + (coerceNumber(resolveValue(row, spec.valueColumn)) ?? 0), 0);
  }

  if (spec.type === "count_distinct") {
    return new Set(rows.map((row) => String(resolveValue(row, spec.valueColumn) ?? ""))).size;
  }

  if (spec.type === "count") {
    return rows.length;
  }

  if (spec.type === "ratio") {
    const numerator = rows.filter((row) => applyFilters([row], spec.numerator?.filter ?? []).length > 0).length;
    const denominator = rows.length;
    return denominator > 0 ? numerator / denominator : 0;
  }

  if (spec.type === "share") {
    return totalRowCount > 0 ? rows.length / totalRowCount : 0;
  }

  if (spec.type === "delta") {
    const values = rows.map((row) => coerceNumber(resolveValue(row, spec.valueColumn))).filter((value): value is number => value !== null);
    return values.length > 0 ? values.reduce((total, value) => total + value, 0) : 0;
  }

  if (spec.type === "rank") {
    if (spec.valueColumn) {
      return rows.reduce((total, row) => total + (coerceNumber(resolveValue(row, spec.valueColumn)) ?? 0), 0);
    }

    return rows.length;
  }

  return rows.length;
}

async function groupRows(rows: JoinedRow[], groupBy: string[], heartbeat: AnalyticsHeartbeat) {
  if (groupBy.length === 0) {
    return [{ key: "overall", rows }];
  }

  const groups = new Map<string, JoinedRow[]>();

  let index = 0;
  for (const row of rows) {
    index += 1;
    if (index % 2_000 === 0) {
      await heartbeat.tick();
    }
    const key = groupBy.map((column) => String(resolveValue(row, column) ?? "unknown")).join(" | ");
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  return [...groups.entries()].map(([key, groupRowsValue]) => ({
    key,
    rows: groupRowsValue,
  }));
}

function prefixKeys(row: Record<string, unknown>, fileName: string) {
  const normalizedFile = slugify(fileName);
  return Object.fromEntries(
    Object.entries(row).flatMap(([key, value]) => [
      [key, value],
      [`${normalizedFile}.${key}`, value],
    ]),
  );
}

async function innerJoinRows(
  leftRows: JoinedRow[],
  rightRows: Array<Record<string, unknown>>,
  leftKey: string,
  rightKey: string,
  rightFileName: string,
  heartbeat: AnalyticsHeartbeat,
) {
  const rightMap = new Map<string, JoinedRow[]>();
  let rightIndex = 0;
  for (const row of rightRows) {
    rightIndex += 1;
    if (rightIndex % 2_000 === 0) {
      await heartbeat.tick();
    }
    const key = String(row[rightKey] ?? "");
    const existing = rightMap.get(key);
    const prefixed = prefixKeys(row, rightFileName);
    if (existing) {
      existing.push(prefixed);
    } else {
      rightMap.set(key, [prefixed]);
    }
  }

  const joinedRows: JoinedRow[] = [];
  let leftIndex = 0;

  for (const leftRow of leftRows) {
    leftIndex += 1;
    if (leftIndex % 2_000 === 0) {
      await heartbeat.tick();
    }
    const joinValue = String(resolveValue(leftRow, leftKey) ?? "");
    const matches = rightMap.get(joinValue);
    if (!matches || matches.length === 0) {
      continue;
    }

    joinedRows.push(
      ...matches.map((match) => ({
        ...leftRow,
        ...match,
      })),
    );
  }

  return joinedRows;
}

function applyFilters(rows: JoinedRow[], filters: ExecutableMetricSpec["filter"]) {
  return rows.filter((row) =>
    filters.every((filter) => {
      const value = resolveValue(row, filter.column);
      const numericValue = coerceNumber(value);
      const numericFilterValue = typeof filter.value === "number" ? filter.value : null;
      if (filter.operator === "eq") {
        return value === filter.value;
      }
      if (filter.operator === "neq") {
        return value !== filter.value;
      }
      if (filter.operator === "gt") {
        return numericValue !== null && numericFilterValue !== null ? numericValue > numericFilterValue : false;
      }
      if (filter.operator === "gte") {
        return numericValue !== null && numericFilterValue !== null ? numericValue >= numericFilterValue : false;
      }
      if (filter.operator === "lt") {
        return numericValue !== null && numericFilterValue !== null ? numericValue < numericFilterValue : false;
      }
      if (filter.operator === "lte") {
        return numericValue !== null && numericFilterValue !== null ? numericValue <= numericFilterValue : false;
      }
      if (filter.operator === "contains") {
        return String(value ?? "").toLowerCase().includes(String(filter.value).toLowerCase());
      }
      if (filter.operator === "in" && Array.isArray(filter.value)) {
        return filter.value.includes(value as never);
      }
      return true;
    }),
  );
}

function resolveValue(row: JoinedRow, column?: string) {
  if (!column) {
    return undefined;
  }

  if (column in row) {
    return row[column];
  }

  const candidateKey = Object.keys(row).find((key) => key.endsWith(`.${column}`));
  return candidateKey ? row[candidateKey] : undefined;
}

function parseFilterValue(value: string) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value.replace(/^["']|["']$/g, "");
}

function coerceNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = parseNumericString(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseNumericString(value: string) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Detect NA/null indicators
  if (/^(n\/a|na|null|nil|-{1,3}|—|–|\.{1,3})$/i.test(trimmed)) {
    return null;
  }

  let candidate = trimmed
    .replace(/^[€$£¥₹₽₩]\s*/g, "")          // Leading currency symbols
    .replace(/\s*[€$£¥₹₽₩%]$/g, "")          // Trailing currency/percent symbols
    .replace(/^(USD|EUR|GBP|CHF|JPY)\s*/i, "") // ISO currency prefix
    .replace(/\s*(USD|EUR|GBP|CHF|JPY)$/i, "") // ISO currency suffix
    .replace(/\s+/g, "")                        // Whitespace (thousand separator in some locales)
    .replace(/[‘\u2019\u02BC\u201B`\u00B4]/g, ""); // All apostrophe/quote variants as thousand separators

  if (!/[0-9]/.test(candidate)) {
    return null;
  }

  const lastComma = candidate.lastIndexOf(",");
  const lastDot = candidate.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      candidate = candidate.replaceAll(".", "").replace(",", ".");
    } else {
      candidate = candidate.replaceAll(",", "");
    }
  } else if (lastComma >= 0) {
    const decimalDigits = candidate.length - lastComma - 1;
    candidate = decimalDigits > 0 && decimalDigits <= 2
      ? candidate.replace(",", ".")
      : candidate.replaceAll(",", "");
  }

  if (!/^-?\d+(\.\d+)?$/.test(candidate)) {
    return null;
  }

  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeStddev(values: number[]) {
  if (values.length < 2) {
    return 0;
  }

  const average = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function computeEvidenceConfidence(
  metric: ExecutableMetricSpec,
  groupRows: Record<string, unknown>[],
  allRows: Record<string, unknown>[],
) {
  if (groupRows.length === 0 || allRows.length === 0) {
    return 0.5;
  }

  const metricColumn = metric.valueColumn ?? metric.numerator?.column ?? metric.denominator?.column;
  const coverage = groupRows.length / allRows.length;
  const nullRate = metricColumn
    ? groupRows.filter((row) => resolveValue(row, metricColumn) == null).length / groupRows.length
    : 0;
  const sampleSize = groupRows.length;

  let confidence = 0.5;
  if (sampleSize >= 100) confidence += 0.2;
  else if (sampleSize >= 30) confidence += 0.1;
  if (coverage >= 0.1) confidence += 0.1;
  if (nullRate < 0.05) confidence += 0.1;
  if (nullRate < 0.01) confidence += 0.05;

  return Math.min(0.99, Math.round(confidence * 100) / 100);
}

function applySortAndLimit(
  rows: Array<{ key: string; value: number; count: number }>,
  spec: ExecutableMetricSpec,
) {
  let nextRows = rows.slice();

  if (spec.sortBy) {
    const direction = spec.sortBy.direction === "asc" ? 1 : -1;
    nextRows.sort((left, right) => direction * (left.value - right.value));
  } else if (spec.type === "delta" && spec.timeColumn) {
    nextRows.sort((left, right) => String(left.key).localeCompare(String(right.key)));
  }

  if (spec.limit) {
    nextRows = nextRows.slice(0, spec.limit);
  }

  return nextRows;
}

function buildDistributions(metrics: AnalyticsResult["metrics"], derivedTables: AnalyticsResult["derivedTables"]) {
  return metrics.slice(0, 6).map((metric) => {
    const table = derivedTables.find((candidate) => candidate.name === `${metric.name}_table`);
    const values = (table?.rows ?? [])
      .map((row) => coerceNumber(row.value))
      .filter((value): value is number => value !== null);

    return {
      metric: metric.name,
      histogram: values.map((value, index) => ({
        bucket: `bucket_${index + 1}`,
        count: Math.round(value),
      })),
      skew: 0,
      kurtosis: 0,
    };
  });
}

function buildOutliers(derivedTables: AnalyticsResult["derivedTables"]) {
  const outliers: AnalyticsResult["outliers"] = [];

  for (const table of derivedTables) {
    const values = table.rows
      .map((row) => ({ key: String(row.key ?? "unknown"), value: coerceNumber(row.value) }))
      .filter((row): row is { key: string; value: number } => row.value !== null);

    if (values.length < 3) {
      continue;
    }

    const average = values.reduce((total, row) => total + row.value, 0) / values.length;
    const variance = values.reduce((total, row) => total + (row.value - average) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    for (const row of values) {
      if (stdDev === 0) {
        continue;
      }

      const zscore = (row.value - average) / stdDev;
      if (Math.abs(zscore) >= 1.5) {
        outliers.push({
          entity: row.key,
          metric: table.name,
          value: row.value,
          zscore,
          direction: zscore > 0 ? "high" : "low",
        });
      }
    }
  }

  return outliers;
}

function buildCorrelations(derivedTables: AnalyticsResult["derivedTables"]) {
  const numericTables = derivedTables
    .filter((table) => table.rows.length > 2)
    .slice(0, 4)
    .map((table) => ({
      name: table.name,
      valuesByKey: new Map(
        table.rows
          .map((row) => [String(row.key ?? "unknown"), coerceNumber(row.value)] as const)
          .filter((entry): entry is readonly [string, number] => entry[1] !== null),
      ),
    }))
    .filter((table) => table.valuesByKey.size > 2);
  const correlations: AnalyticsResult["correlations"] = [];

  for (let index = 0; index < numericTables.length - 1; index += 1) {
    const left = numericTables[index];
    const right = numericTables[index + 1];
    const sharedKeys = [...left.valuesByKey.keys()].filter((key) => right.valuesByKey.has(key));
    const sampleSize = sharedKeys.length;
    if (sampleSize < 3) {
      continue;
    }
    const leftValues = sharedKeys.map((key) => left.valuesByKey.get(key) ?? 0);
    const rightValues = sharedKeys.map((key) => right.valuesByKey.get(key) ?? 0);
    const r = pearson(leftValues, rightValues);
    correlations.push({
      metric1: left.name,
      metric2: right.name,
      r,
      significance: Math.abs(r) > 0.7 ? "high" : Math.abs(r) > 0.4 ? "medium" : "low",
    });
  }

  return correlations;
}

function buildSegmentBreakdowns(derivedTables: AnalyticsResult["derivedTables"]) {
  return derivedTables.slice(0, 6).map((table) => ({
    dimension: table.name,
    segments: table.rows.slice(0, 6).map((row) => ({
      name: String(row.key ?? "unknown"),
      metrics: {
        value: coerceNumber(row.value) ?? 0,
        count: coerceNumber(row.count) ?? 0,
      },
    })),
  }));
}

function pearson(left: number[], right: number[]) {
  const leftAverage = left.reduce((total, value) => total + value, 0) / left.length;
  const rightAverage = right.reduce((total, value) => total + value, 0) / right.length;
  const numerator = left.reduce((total, value, index) => total + (value - leftAverage) * (right[index] - rightAverage), 0);
  const leftVariance = Math.sqrt(left.reduce((total, value) => total + (value - leftAverage) ** 2, 0));
  const rightVariance = Math.sqrt(right.reduce((total, value) => total + (value - rightAverage) ** 2, 0));

  if (leftVariance === 0 || rightVariance === 0) {
    return 0;
  }

  return numerator / (leftVariance * rightVariance);
}

function groupDimensions(groupBy: string[], key: string) {
  const values = key.split(" | ");
  return Object.fromEntries(groupBy.map((column, index) => [column, values[index] ?? "unknown"]));
}

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function createAnalyticsHeartbeat(onHeartbeat?: () => Promise<void> | void): AnalyticsHeartbeat {
  let operationsSinceLastYield = 0;
  let lastYieldAt = Date.now();

  return {
    async tick() {
      operationsSinceLastYield += 1;
      const shouldYield = operationsSinceLastYield >= 32 || Date.now() - lastYieldAt >= 750;

      if (!shouldYield) {
        return;
      }

      operationsSinceLastYield = 0;
      lastYieldAt = Date.now();
      await Promise.resolve(onHeartbeat?.());
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}
