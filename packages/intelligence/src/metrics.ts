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
import { compactUnique } from "./utils";

type PlanMetricsInput = {
  datasetProfile: DatasetProfile;
  packageSemantics: PackageSemantics;
  brief: ReportBrief;
  reviewFeedback?: string[];
};

type TraceOptions = {
  onTrace?: (trace: StageTrace) => void;
};

export async function planMetrics(
  input: PlanMetricsInput,
  options: TraceOptions = {},
): Promise<ExecutableMetricSpec[]> {
  const compactProfile = buildCompactMetricProfile(input.datasetProfile);
  const modelId = process.env.BASQUIO_METRIC_MODEL || "gpt-5-mini";
  const llmResult = await generateStructuredStage({
    stage: "metric-planner",
    schema: z.object({
      metrics: z.array(executableMetricSpecSchema).min(1).max(24),
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

  const validSpecs = sanitizeMetricPlan(llmResult.object?.metrics ?? [], input.datasetProfile, input.packageSemantics);
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

  return metrics.slice(0, 24).map((metric) => executableMetricSpecSchema.parse(metric));
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

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
