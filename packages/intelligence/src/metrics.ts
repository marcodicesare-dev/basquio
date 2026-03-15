import { z } from "zod";

import {
  executableMetricSpecSchema,
  type DatasetProfile,
  type ExecutableMetricSpec,
  type PackageSemantics,
  type ReportBrief,
  type StageTrace,
} from "@basquio/types";

import { generateStructuredStage } from "./model";
import { compactUnique, isRetailMarketDataset, matchColumnName } from "./utils";

type PlanMetricsInput = {
  datasetProfile: DatasetProfile;
  packageSemantics: PackageSemantics;
  brief: ReportBrief;
  reviewFeedback?: string[];
};

type TraceOptions = {
  onTrace?: (trace: StageTrace) => void;
};

const llmFilterConditionSchema = z.object({
  column: z.string(),
  operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()]))]),
});

const llmMetricAggregateSchema = z.object({
  aggregation: z.enum(["count", "count_distinct", "sum"]),
  column: z.string().nullable(),
  filter: z.array(llmFilterConditionSchema),
});

const llmMetricSpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["ratio", "count", "count_distinct", "sum", "average", "delta", "rank", "share"]),
  sourceFile: z.string(),
  joinFiles: z.array(z.string()),
  joins: z.array(
    z.object({
      file: z.string(),
      leftKey: z.string(),
      rightKey: z.string(),
    }),
  ),
  valueColumn: z.string().nullable(),
  groupBy: z.array(z.string()),
  filter: z.array(llmFilterConditionSchema),
  numerator: llmMetricAggregateSchema.nullable(),
  denominator: llmMetricAggregateSchema.nullable(),
  timeColumn: z.string().nullable(),
  sortBy: z
    .object({
      column: z.string(),
      direction: z.enum(["asc", "desc"]),
    })
    .nullable(),
  limit: z.number().int().min(1).nullable(),
});

export async function planMetrics(
  input: PlanMetricsInput,
  options: TraceOptions = {},
): Promise<ExecutableMetricSpec[]> {
  const compactProfile = buildCompactMetricProfile(input.datasetProfile);
  const modelId = process.env.BASQUIO_METRIC_MODEL || "gpt-5-mini";
  const llmResult = await generateStructuredStage({
    stage: "metric-planner",
    schema: z.object({
      metrics: z.array(llmMetricSpecSchema).min(1).max(24),
    }),
    modelId,
    providerPreference: modelId.startsWith("claude") ? "anthropic" : "openai",
    prompt: [
      "You are a metric-planning analyst for executive report generation.",
      "Plan executable metrics from the package semantics and dataset profile.",
      "Use only files, columns, joins, and filters that actually exist.",
      "Prefer 8-18 metrics with a mix of count, count_distinct, sum, average, share, ratio, delta, and rank when the package supports them.",
      "AI should decide what to compute; downstream code will compute the numbers deterministically.",
      "",
      "## Brief",
      JSON.stringify(input.brief, null, 2),
      "",
      "## Package semantics",
      JSON.stringify(input.packageSemantics, null, 2),
      "",
      "## Dataset profile",
      JSON.stringify(compactProfile, null, 2),
      "",
      ...(input.reviewFeedback?.length
        ? [
            "## Reviewer feedback to address",
            ...input.reviewFeedback.map((item) => `- ${item}`),
            "",
          ]
        : []),
      "Return executable metric specs only.",
    ].join("\n"),
  });
  options.onTrace?.(llmResult.trace);

  const validSpecs = sanitizeMetricPlan(
    (llmResult.object?.metrics ?? []).map((metric) => ({
      ...metric,
      valueColumn: metric.valueColumn ?? undefined,
      numerator: metric.numerator
        ? {
            ...metric.numerator,
            column: metric.numerator.column ?? undefined,
          }
        : undefined,
      denominator: metric.denominator
        ? {
            ...metric.denominator,
            column: metric.denominator.column ?? undefined,
          }
        : undefined,
      timeColumn: metric.timeColumn ?? undefined,
      sortBy: metric.sortBy ?? undefined,
      limit: metric.limit ?? undefined,
    })),
    input.datasetProfile,
    input.packageSemantics,
  );
  if (validSpecs.length > 0) {
    return validSpecs;
  }

  return buildFallbackMetricPlan(input.datasetProfile, input.packageSemantics);
}

function buildCompactMetricProfile(datasetProfile: DatasetProfile) {
  return {
    files: datasetProfile.sourceFiles.map((file) => ({
      fileName: file.fileName,
      role: file.role,
    })),
    sheets: datasetProfile.sheets.map((sheet) => ({
      sourceFileName: sheet.sourceFileName,
      name: sheet.name,
      rowCount: sheet.rowCount,
      columns: sheet.columns.map((column) => ({
        name: column.name,
        role: column.role,
        inferredType: column.inferredType,
        nullable: column.nullable,
        uniqueCount: column.uniqueCount,
      })),
    })),
  };
}

function sanitizeMetricPlan(
  specs: ExecutableMetricSpec[],
  datasetProfile: DatasetProfile,
  packageSemantics: PackageSemantics,
) {
  const sheetColumns = new Map(
    datasetProfile.sheets.map((sheet) => [
      sheet.sourceFileName,
      new Set(sheet.columns.map((column) => column.name)),
    ]),
  );
  const validFiles = new Set(datasetProfile.sheets.map((sheet) => sheet.sourceFileName));
  const validRelationships = new Set(
    packageSemantics.relationships.flatMap((relationship) => [
      `${relationship.fromFile}|${relationship.toFile}|${relationship.leftKey}|${relationship.rightKey}`,
      `${relationship.toFile}|${relationship.fromFile}|${relationship.rightKey}|${relationship.leftKey}`,
    ]),
  );

  return specs
    .filter((spec) => validFiles.has(spec.sourceFile))
    .filter((spec) => spec.joinFiles.every((file) => validFiles.has(file)))
    .filter((spec) => spec.joins.every((join) => validFiles.has(join.file)))
    .filter((spec) =>
      spec.joinFiles.every((file) =>
        spec.joins.length > 0
          ? spec.joins.some((join) => join.file === file)
          : packageSemantics.relationships.some(
              (relationship) =>
                relationship.fromFile === spec.sourceFile && relationship.toFile === file,
            ),
      ),
    )
    .filter((spec) =>
      spec.joins.every((join) =>
        validRelationships.has(`${spec.sourceFile}|${join.file}|${join.leftKey}|${join.rightKey}`),
      ),
    )
    .filter((spec) => hasValidColumn(sheetColumns, spec.sourceFile, spec.valueColumn))
    .filter((spec) => spec.groupBy.every((column) => hasValidColumn(sheetColumns, spec.sourceFile, column)))
    .filter((spec) => hasValidColumn(sheetColumns, spec.sourceFile, spec.timeColumn))
    .filter((spec) => spec.joins.every((join) => hasValidColumn(sheetColumns, spec.sourceFile, join.leftKey)))
    .filter((spec) => spec.joins.every((join) => hasValidColumn(sheetColumns, join.file, join.rightKey)))
    .filter((spec) => hasValidFilterColumns(sheetColumns, spec.sourceFile, spec.filter))
    .filter((spec) => hasValidFilterColumns(sheetColumns, spec.sourceFile, spec.numerator?.filter ?? []))
    .filter((spec) => hasValidFilterColumns(sheetColumns, spec.sourceFile, spec.denominator?.filter ?? []))
    .map((spec) => executableMetricSpecSchema.parse(spec))
    .slice(0, 24);
}

function buildFallbackMetricPlan(
  datasetProfile: DatasetProfile,
  packageSemantics: PackageSemantics,
) {
  if (isRetailMarketDataset(datasetProfile)) {
    return buildRetailMetricPlan(datasetProfile);
  }

  const metrics: ExecutableMetricSpec[] = [];
  const seen = new Set<string>();

  for (const sheet of datasetProfile.sheets) {
    const measures = sheet.columns.filter((column) => column.role === "measure");
    const dimensions = sheet.columns.filter((column) => column.role === "dimension" || column.role === "segment");
    const identifiers = sheet.columns.filter((column) => column.role === "identifier");
    const booleans = sheet.columns.filter((column) => column.inferredType === "boolean");
    const timeColumn = sheet.columns.find((column) => column.role === "time")?.name;
    const primaryDimension = dimensions[0]?.name;
    const dimensionPool = compactUnique([primaryDimension, ...dimensions.slice(1, 3).map((column) => column.name)]);

    pushMetric(metrics, seen, {
      id: `${slugify(sheet.sourceFileName)}-row-count`,
      name: `${slugify(sheet.sourceFileName)}_row_count`,
      type: "count",
      sourceFile: sheet.sourceFileName,
      joinFiles: [],
      joins: [],
      groupBy: compactUnique([primaryDimension]),
      filter: [],
      timeColumn,
    });

    for (const identifier of identifiers.slice(0, 2)) {
      pushMetric(metrics, seen, {
        id: `${slugify(sheet.sourceFileName)}-${slugify(identifier.name)}-distinct`,
        name: `${slugify(identifier.name)}_distinct_count`,
        type: "count_distinct",
        sourceFile: sheet.sourceFileName,
        joinFiles: [],
        joins: [],
        valueColumn: identifier.name,
        groupBy: compactUnique([primaryDimension]),
        filter: [],
        timeColumn,
      });
    }

    for (const measure of measures.slice(0, 4)) {
      pushMetric(metrics, seen, {
        id: `${slugify(sheet.sourceFileName)}-${slugify(measure.name)}-sum`,
        name: `${slugify(measure.name)}_sum`,
        type: "sum",
        sourceFile: sheet.sourceFileName,
        joinFiles: [],
        joins: [],
        valueColumn: measure.name,
        groupBy: dimensionPool.slice(0, 1),
        filter: [],
        timeColumn,
      });

      pushMetric(metrics, seen, {
        id: `${slugify(sheet.sourceFileName)}-${slugify(measure.name)}-avg`,
        name: `${slugify(measure.name)}_average`,
        type: "average",
        sourceFile: sheet.sourceFileName,
        joinFiles: [],
        joins: [],
        valueColumn: measure.name,
        groupBy: compactUnique([primaryDimension]),
        filter: [],
        timeColumn,
      });

      if (timeColumn) {
        pushMetric(metrics, seen, {
          id: `${slugify(sheet.sourceFileName)}-${slugify(measure.name)}-delta`,
          name: `${slugify(measure.name)}_delta_over_time`,
          type: "delta",
          sourceFile: sheet.sourceFileName,
          joinFiles: [],
          joins: [],
          valueColumn: measure.name,
          groupBy: [timeColumn],
          filter: [],
          timeColumn,
        });
      }

      if (primaryDimension) {
        pushMetric(metrics, seen, {
          id: `${slugify(sheet.sourceFileName)}-${slugify(measure.name)}-rank`,
          name: `${slugify(measure.name)}_rank_by_${slugify(primaryDimension)}`,
          type: "rank",
          sourceFile: sheet.sourceFileName,
          joinFiles: [],
          joins: [],
          valueColumn: measure.name,
          groupBy: [primaryDimension],
          filter: [],
          timeColumn,
          sortBy: {
            column: measure.name,
            direction: "desc",
          },
          limit: 8,
        });
      }
    }

    for (const booleanColumn of booleans.slice(0, 2)) {
      pushMetric(metrics, seen, {
        id: `${slugify(sheet.sourceFileName)}-${slugify(booleanColumn.name)}-rate`,
        name: `${slugify(booleanColumn.name)}_rate`,
        type: "ratio",
        sourceFile: sheet.sourceFileName,
        joinFiles: [],
        joins: [],
        groupBy: compactUnique([primaryDimension]),
        filter: [],
        numerator: {
          aggregation: "count",
          filter: [
            {
              column: booleanColumn.name,
              operator: "eq",
              value: true,
            },
          ],
        },
        denominator: {
          aggregation: "count",
          filter: [],
        },
        timeColumn,
      });
    }

    if (primaryDimension) {
      pushMetric(metrics, seen, {
        id: `${slugify(sheet.sourceFileName)}-${slugify(primaryDimension)}-share`,
        name: `${slugify(primaryDimension)}_share`,
        type: "share",
        sourceFile: sheet.sourceFileName,
        joinFiles: [],
        joins: [],
        groupBy: [primaryDimension],
        filter: [],
        timeColumn,
      });
    }
  }

  const relationshipAnchors = packageSemantics.relationships.slice(0, 4);
  for (const relationship of relationshipAnchors) {
    pushMetric(metrics, seen, {
      id: `${slugify(relationship.fromFile)}-${slugify(relationship.toFile)}-join-count`,
      name: `${slugify(relationship.fromFile)}_to_${slugify(relationship.toFile)}_join_count`,
      type: "count",
      sourceFile: relationship.fromFile,
      joinFiles: [relationship.toFile],
      joins: [
        {
          file: relationship.toFile,
          leftKey: relationship.leftKey,
          rightKey: relationship.rightKey,
        },
      ],
      groupBy: [relationship.leftKey],
      filter: [],
    });
  }

  return metrics.map((metric) => executableMetricSpecSchema.parse(metric));
}

function buildRetailMetricPlan(datasetProfile: DatasetProfile) {
  const metrics: ExecutableMetricSpec[] = [];
  const seen = new Set<string>();
  const sheet = datasetProfile.sheets[0];

  if (!sheet) {
    return [];
  }

  const sourceFile = sheet.sourceFileName;
  const marketColumn = findColumn(sheet, [/^MERCATO_ECR4$/i, /^MERCATO/i]);
  const familyColumn = findColumn(sheet, [/^FAMIGLIA_ECR3$/i, /^FAMIGLIA/i]);
  const compartmentColumn = findColumn(sheet, [/^COMPARTO_ECR2$/i, /^COMPARTO/i]);
  const supplierColumn = findColumn(sheet, [/^FORNITORE$/i]);
  const brandColumn = findColumn(sheet, [/^MARCA$/i]);
  const itemCodeColumn = findColumn(sheet, [/^ITEM CODE$/i, /^ITEM_CODE$/i, /^SKU$/i]);
  const currentValueColumn = findColumn(sheet, [/^V\.\s*Valore$/i]);
  const priorValueColumn = findColumn(sheet, [/^V\.\s*Valore Anno prec\.$/i, /^V\.\s*Valore Anno Prec/i]);
  const currentVolumeColumn = findColumn(sheet, [/^V\.\s*\(ALL\)$/i]);
  const priorVolumeColumn = findColumn(sheet, [/^V\.\s*\(ALL\)\s*Anno prec\.$/i, /^V\.\s*\(ALL\)\s*Anno Prec/i]);

  if (!currentValueColumn || !priorValueColumn || !supplierColumn || !brandColumn || !marketColumn) {
    return [];
  }

  const primaryDimensions = compactUnique([
    compartmentColumn,
    familyColumn,
    marketColumn,
    supplierColumn,
    brandColumn,
  ]);

  for (const dimension of primaryDimensions) {
    pushMetric(metrics, seen, retailMetric({
      id: `${slugify(dimension)}-value-current`,
      name: `retail_value_current_by_${slugify(dimension)}`,
      type: "sum",
      sourceFile,
      valueColumn: currentValueColumn,
      groupBy: [dimension],
    }));
    pushMetric(metrics, seen, retailMetric({
      id: `${slugify(dimension)}-value-prior`,
      name: `retail_value_prior_by_${slugify(dimension)}`,
      type: "sum",
      sourceFile,
      valueColumn: priorValueColumn,
      groupBy: [dimension],
    }));

    if (currentVolumeColumn) {
      pushMetric(metrics, seen, retailMetric({
        id: `${slugify(dimension)}-volume-current`,
        name: `retail_volume_current_by_${slugify(dimension)}`,
        type: "sum",
        sourceFile,
        valueColumn: currentVolumeColumn,
        groupBy: [dimension],
      }));
    }

    if (priorVolumeColumn) {
      pushMetric(metrics, seen, retailMetric({
        id: `${slugify(dimension)}-volume-prior`,
        name: `retail_volume_prior_by_${slugify(dimension)}`,
        type: "sum",
        sourceFile,
        valueColumn: priorVolumeColumn,
        groupBy: [dimension],
      }));
    }
  }

  pushMetric(metrics, seen, retailMetric({
    id: "retail-value-current-by-supplier-rank",
    name: "retail_value_current_rank_by_supplier",
    type: "rank",
    sourceFile,
    valueColumn: currentValueColumn,
    groupBy: [supplierColumn],
    sortBy: {
      column: currentValueColumn,
      direction: "desc",
    },
    limit: 12,
  }));

  pushMetric(metrics, seen, retailMetric({
    id: "retail-value-current-by-brand-rank",
    name: "retail_value_current_rank_by_brand",
    type: "rank",
    sourceFile,
    valueColumn: currentValueColumn,
    groupBy: [brandColumn],
    sortBy: {
      column: currentValueColumn,
      direction: "desc",
    },
    limit: 16,
  }));

  pushMetric(metrics, seen, retailMetric({
    id: "retail-value-current-by-market-brand",
    name: "retail_value_current_by_market_brand",
    type: "rank",
    sourceFile,
    valueColumn: currentValueColumn,
    groupBy: [marketColumn, brandColumn],
    sortBy: {
      column: currentValueColumn,
      direction: "desc",
    },
    limit: 96,
  }));

  pushMetric(metrics, seen, retailMetric({
    id: "retail-value-prior-by-market-brand",
    name: "retail_value_prior_by_market_brand",
    type: "sum",
    sourceFile,
    valueColumn: priorValueColumn,
    groupBy: [marketColumn, brandColumn],
  }));

  if (currentVolumeColumn) {
    pushMetric(metrics, seen, retailMetric({
      id: "retail-volume-current-by-market-brand",
      name: "retail_volume_current_by_market_brand",
      type: "sum",
      sourceFile,
      valueColumn: currentVolumeColumn,
      groupBy: [marketColumn, brandColumn],
    }));
  }

  if (priorVolumeColumn) {
    pushMetric(metrics, seen, retailMetric({
      id: "retail-volume-prior-by-market-brand",
      name: "retail_volume_prior_by_market_brand",
      type: "sum",
      sourceFile,
      valueColumn: priorVolumeColumn,
      groupBy: [marketColumn, brandColumn],
    }));
  }

  for (const affinityFilter of [
    { label: "affinity", column: supplierColumn, value: "AFFINITY" },
    { label: "mdd", column: brandColumn, value: "MDD" },
  ]) {
    pushMetric(metrics, seen, retailMetric({
      id: `${affinityFilter.label}-value-current-by-market`,
      name: `retail_${affinityFilter.label}_value_current_by_market`,
      type: "sum",
      sourceFile,
      valueColumn: currentValueColumn,
      groupBy: [marketColumn],
      filter: [
        {
          column: affinityFilter.column,
          operator: affinityFilter.value === "MDD" ? "contains" : "eq",
          value: affinityFilter.value,
        },
      ],
    }));
    pushMetric(metrics, seen, retailMetric({
      id: `${affinityFilter.label}-value-prior-by-market`,
      name: `retail_${affinityFilter.label}_value_prior_by_market`,
      type: "sum",
      sourceFile,
      valueColumn: priorValueColumn,
      groupBy: [marketColumn],
      filter: [
        {
          column: affinityFilter.column,
          operator: affinityFilter.value === "MDD" ? "contains" : "eq",
          value: affinityFilter.value,
        },
      ],
    }));
  }

  pushMetric(metrics, seen, retailMetric({
    id: "retail-affinity-value-current-by-brand",
    name: "retail_affinity_value_current_by_brand",
    type: "sum",
    sourceFile,
    valueColumn: currentValueColumn,
    groupBy: [brandColumn],
    filter: [{ column: supplierColumn, operator: "eq", value: "AFFINITY" }],
  }));
  pushMetric(metrics, seen, retailMetric({
    id: "retail-affinity-value-prior-by-brand",
    name: "retail_affinity_value_prior_by_brand",
    type: "sum",
    sourceFile,
    valueColumn: priorValueColumn,
    groupBy: [brandColumn],
    filter: [{ column: supplierColumn, operator: "eq", value: "AFFINITY" }],
  }));
  if (itemCodeColumn) {
    pushMetric(metrics, seen, retailMetric({
      id: "retail-affinity-sku-count-by-brand",
      name: "retail_affinity_sku_count_by_brand",
      type: "count_distinct",
      sourceFile,
      valueColumn: itemCodeColumn,
      groupBy: [brandColumn],
      filter: [{ column: supplierColumn, operator: "eq", value: "AFFINITY" }],
    }));
  }

  return metrics.map((metric) => executableMetricSpecSchema.parse(metric));
}

function retailMetric(metric: {
  id: string;
  name: string;
  type: ExecutableMetricSpec["type"];
  sourceFile: string;
  valueColumn?: string;
  groupBy: string[];
  filter?: ExecutableMetricSpec["filter"];
  sortBy?: ExecutableMetricSpec["sortBy"];
  limit?: number;
}) {
  return {
    id: metric.id,
    name: metric.name,
    type: metric.type,
    sourceFile: metric.sourceFile,
    joinFiles: [],
    joins: [],
    valueColumn: metric.valueColumn,
    groupBy: metric.groupBy,
    filter: metric.filter ?? [],
    sortBy: metric.sortBy,
    limit: metric.limit,
  } satisfies ExecutableMetricSpec;
}

function pushMetric(target: ExecutableMetricSpec[], seen: Set<string>, metric: ExecutableMetricSpec) {
  const key = JSON.stringify(metric);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  target.push(metric);
}

function hasValidColumn(
  sheetColumns: Map<string, Set<string>>,
  sourceFile: string,
  column?: string,
) {
  if (!column) {
    return true;
  }

  return sheetColumns.get(sourceFile)?.has(column) ?? false;
}

function hasValidFilterColumns(
  sheetColumns: Map<string, Set<string>>,
  sourceFile: string,
  filters: ExecutableMetricSpec["filter"],
) {
  return filters.every((filter) => hasValidColumn(sheetColumns, sourceFile, filter.column));
}

function findColumn(sheet: DatasetProfile["sheets"][number], patterns: RegExp[]) {
  return sheet.columns.find((column) => matchColumnName(column.name, patterns))?.name;
}

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
