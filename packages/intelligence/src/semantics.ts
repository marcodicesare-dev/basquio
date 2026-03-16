import { z } from "zod";

import {
  packageSemanticsSchema,
  type DatasetProfile,
  type NormalizedWorkbook,
  type PackageSemantics,
  type ReportBrief,
  type StageTrace,
} from "@basquio/types";

import { generateStructuredStage } from "./model";
import { compactUnique, findDimensionColumns, findTimeColumns, getSupportText } from "./utils";

type InterpretPackageSemanticsInput = {
  datasetProfile: DatasetProfile;
  workbook: NormalizedWorkbook;
  brief: ReportBrief;
};

type TraceOptions = {
  onTrace?: (trace: StageTrace) => void;
};

type CompactProfile = ReturnType<typeof buildCompactProfile>;

export async function interpretPackageSemantics(
  input: InterpretPackageSemanticsInput,
  options: TraceOptions = {},
): Promise<PackageSemantics> {
  const compactProfile = buildCompactProfile(input.datasetProfile, input.workbook);
  const methodologyContext = getSupportText(input.workbook, "methodology-guide") || undefined;
  const definitionsContext = getSupportText(input.workbook, "definitions-guide") || undefined;
  const modelId = process.env.BASQUIO_PACKAGE_SEMANTICS_MODEL || "claude-sonnet-4-6";
  const llmResult = await generateStructuredStage({
    stage: "package-semantics",
    schema: packageSemanticsSchema,
    modelId,
    providerPreference: modelId.startsWith("claude") ? "anthropic" : "openai",
    prompt: [
      "You are a senior analytical strategist interpreting a multi-file evidence package.",
      "Infer what the package is, how the files relate, what can be computed, and what questions are reportable.",
      "Only use information present in the provided profile. Do not invent columns, joins, or metrics.",
      "",
      "## File profiles:",
      JSON.stringify(compactProfile, null, 2),
      "",
      ...(methodologyContext
        ? [
            "## Methodology context (from uploaded documentation):",
            methodologyContext.slice(0, 8000),
            "",
          ]
        : []),
      ...(definitionsContext
        ? [
            "## Data definitions (from uploaded documentation):",
            definitionsContext.slice(0, 4000),
            "",
          ]
        : []),
      "## Report brief:",
      JSON.stringify(input.brief, null, 2),
    ].join("\n"),
  });
  options.onTrace?.(llmResult.trace);

  if (llmResult.object) {
    return packageSemanticsSchema.parse({
      ...llmResult.object,
      methodologyContext: llmResult.object.methodologyContext || methodologyContext,
      definitionsContext: llmResult.object.definitionsContext || definitionsContext,
    });
  }

  return buildFallbackPackageSemantics(input.datasetProfile, input.workbook, input.brief, compactProfile, options);
}

function buildCompactProfile(datasetProfile: DatasetProfile, workbook: NormalizedWorkbook) {
  return {
    files: workbook.files.map((file) => ({
      fileName: file.fileName,
      role: file.role,
      kind: file.kind,
      textContent: file.textContent?.slice(0, 5000),
      sheets: file.sheets.map((sheet) => ({
        name: sheet.name,
        rowCount: sheet.rowCount,
        columns: sheet.columns.map((column) => ({
          name: column.name,
          inferredType: column.inferredType,
          role: column.role,
          sampleValues: column.sampleValues.slice(0, 10),
          uniqueCount: column.uniqueCount,
          ...(column.uniqueCountApproximate ? { uniqueCountApproximate: true } : {}),
          nullRate: column.nullRate,
        })),
        sampleRows: sheet.sampleRows.slice(0, 20),
      })),
    })),
    warnings: datasetProfile.warnings,
  };
}

async function buildFallbackPackageSemantics(
  datasetProfile: DatasetProfile,
  workbook: NormalizedWorkbook,
  brief: ReportBrief,
  compactProfile: CompactProfile,
  options: TraceOptions,
): Promise<PackageSemantics> {
  const candidateDimensions = findDimensionColumns(datasetProfile);
  const candidateTimeAxes = findTimeColumns(datasetProfile);
  const methodologyContext = getSupportText(workbook, "methodology-guide") || undefined;
  const definitionsContext = getSupportText(workbook, "definitions-guide") || undefined;
  const [domain, packageType, entities, relationships] = await Promise.all([
    inferDomain(compactProfile.files, brief, datasetProfile, options),
    inferPackageType(compactProfile.files, brief, datasetProfile, options),
    inferEntities(compactProfile.files, datasetProfile, options),
    inferRelationships(compactProfile.files, datasetProfile, options),
  ]);
  const candidateMetrics = inferCandidateMetrics(datasetProfile, candidateDimensions, candidateTimeAxes);
  const reportableQuestions = compactUnique([
    brief.objective ? `How does the package answer: ${brief.objective}?` : undefined,
    ...candidateMetrics.slice(0, 6).map((metric) => `What does ${metric.description} show?`),
    ...candidateDimensions.slice(0, 4).map((dimension) => `Which ${dimension} segments overperform or underperform?`),
    candidateTimeAxes[0] ? `How do the main measures move over ${candidateTimeAxes[0]}?` : undefined,
  ]).slice(0, 12);

  return packageSemanticsSchema.parse({
    domain,
    packageType,
    entities,
    relationships,
    candidateMetrics,
    candidateDimensions,
    candidateTimeAxes,
    reportableQuestions,
    methodologyContext,
    definitionsContext,
  });
}

async function inferDomain(
  profiles: CompactProfile["files"],
  brief: ReportBrief,
  datasetProfile: DatasetProfile,
  options: TraceOptions,
) {
  const result = await generateStructuredStage({
    stage: "package-domain",
    schema: z.object({
      domain: z.string(),
      confidence: z.number().min(0).max(1),
    }),
    modelId: "nano",
    providerPreference: "openai",
    prompt: [
      "Given these file names and column names, what domain is this data from?",
      "Respond with a specific domain such as AI visibility research, FMCG market analysis, or financial performance.",
      "",
      profiles
        .map((profile) => `${profile.fileName}: [${profile.sheets[0]?.columns.map((column) => column.name).join(", ") || ""}]`)
        .join("\n"),
      "",
      `Brief objective: ${brief.objective}`,
    ].join("\n"),
  });
  options.onTrace?.(result.trace);

  if (result.object?.domain) {
    return result.object.domain;
  }

  return keywordFallbackDomain(datasetProfile, brief);
}

async function inferPackageType(
  profiles: CompactProfile["files"],
  brief: ReportBrief,
  datasetProfile: DatasetProfile,
  options: TraceOptions,
) {
  const result = await generateStructuredStage({
    stage: "package-type",
    schema: z.object({
      packageType: z.string(),
    }),
    modelId: "nano",
    providerPreference: "openai",
    prompt: [
      "Classify this package into a specific analytical package type.",
      "",
      profiles
        .map((profile) => `${profile.fileName} (${profile.role}): [${profile.sheets.flatMap((sheet) => sheet.columns.map((column) => column.name)).join(", ")}]`)
        .join("\n"),
      "",
      `Brief objective: ${brief.objective}`,
    ].join("\n"),
  });
  options.onTrace?.(result.trace);

  if (result.object?.packageType) {
    return result.object.packageType;
  }

  const roles = new Set(datasetProfile.sourceFiles.map((file) => file.role));

  if (roles.has("query-log") && roles.has("response-log") && roles.has("citations-table")) {
    return "multi-platform query-response analysis";
  }

  if (roles.has("main-fact-table") && roles.has("supporting-fact-table")) {
    return "evidence package with primary fact table and supporting schedules";
  }

  return "multi-file analytical evidence package";
}

async function inferEntities(
  profiles: CompactProfile["files"],
  datasetProfile: DatasetProfile,
  options: TraceOptions,
) {
  const result = await generateStructuredStage({
    stage: "package-entities",
    schema: z.object({
      entities: z.array(
        z.object({
          name: z.string(),
          idColumn: z.string(),
          sourceFile: z.string(),
          description: z.string(),
        }),
      ),
    }),
    modelId: "nano",
    providerPreference: "openai",
    prompt: [
      "Identify the core entities in this evidence package.",
      "Use only identifier-like columns that actually appear in the package.",
      "",
      profiles
        .map((profile) => `${profile.fileName}: [${profile.sheets.flatMap((sheet) => sheet.columns.map((column) => column.name)).join(", ")}]`)
      .join("\n"),
    ].join("\n"),
  });
  options.onTrace?.(result.trace);

  if (result.object?.entities?.length) {
    return result.object.entities;
  }

  return datasetProfile.sheets.flatMap((sheet) =>
    sheet.columns
      .filter((column) => column.role === "identifier")
      .map((column) => ({
        name: column.name.replace(/_id$/i, ""),
        idColumn: column.name,
        sourceFile: sheet.sourceFileName,
        description: `${column.name} is a joinable identifier exposed in ${sheet.name}.`,
      })),
  );
}

async function inferRelationships(
  profiles: CompactProfile["files"],
  datasetProfile: DatasetProfile,
  options: TraceOptions,
) {
  const result = await generateStructuredStage({
    stage: "package-relationships",
    schema: z.object({
      relationships: z.array(
        z.object({
          fromFile: z.string(),
          toFile: z.string(),
          leftKey: z.string(),
          rightKey: z.string(),
          relationship: z.enum(["one-to-many", "many-to-many", "one-to-one"]),
          confidence: z.number().min(0).max(1),
          rationale: z.string(),
        }),
      ),
    }),
    modelId: "nano",
    providerPreference: "openai",
    prompt: [
      "Infer file relationships for this evidence package.",
      "Infer file relationships for this evidence package.",
      "You may map different identifier names when the evidence strongly suggests they refer to the same entity.",
      "Use leftKey for the identifier on fromFile and rightKey for the identifier on toFile.",
      "",
      profiles
        .map((profile) => `${profile.fileName}: [${profile.sheets.flatMap((sheet) => sheet.columns.map((column) => column.name)).join(", ")}]`)
      .join("\n"),
    ].join("\n"),
  });
  options.onTrace?.(result.trace);

  if (result.object?.relationships?.length) {
    return dedupeRelationships(result.object.relationships);
  }

  const fileColumns = datasetProfile.sheets.map((sheet) => ({
    fileName: sheet.sourceFileName,
    identifiers: sheet.columns.filter((column) => column.role === "identifier").map((column) => column.name),
  }));
  const relationships: PackageSemantics["relationships"] = [];

  for (const left of fileColumns) {
    for (const right of fileColumns) {
      if (left.fileName === right.fileName) {
        continue;
      }

      const joinKey = left.identifiers.find((column) => right.identifiers.includes(column));

      if (joinKey) {
        relationships.push({
          fromFile: left.fileName,
          toFile: right.fileName,
          leftKey: joinKey,
          rightKey: joinKey,
          relationship: "one-to-many",
          confidence: 0.72,
          rationale: `Shared identifier column ${joinKey} appears in both files.`,
        });
      }
    }
  }

  return dedupeRelationships(relationships);
}

function dedupeRelationships(relationships: PackageSemantics["relationships"]) {
  const seen = new Set<string>();
  return relationships.filter((relationship) => {
    const key = [
      relationship.fromFile,
      relationship.toFile,
      relationship.leftKey,
      relationship.rightKey,
    ].sort().join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function inferCandidateMetrics(
  datasetProfile: DatasetProfile,
  candidateDimensions: string[],
  candidateTimeAxes: string[],
) {
  const metrics: PackageSemantics["candidateMetrics"] = [];

  for (const sheet of datasetProfile.sheets) {
    const measureColumns = sheet.columns.filter((column) => column.role === "measure");
    const booleanColumns = sheet.columns.filter((column) => column.inferredType === "boolean");
    const groupingColumns = sheet.columns.filter(
      (column) => column.role === "dimension" || column.role === "segment" || column.role === "time",
    );

    for (const column of measureColumns) {
      const groupColumn = groupingColumns[0];
      metrics.push({
        name: `${slugify(column.name)}${groupColumn ? `_by_${slugify(groupColumn.name)}` : "_average"}`,
        formula: `average of "${column.name}"${groupColumn ? ` grouped by "${groupColumn.name}"` : ""}`,
        executableSpec: {
          id: `${slugify(column.name)}-average-${sheet.sourceFileId}`,
          name: `${slugify(column.name)}_average`,
          type: "average",
          sourceFile: sheet.sourceFileName,
          joinFiles: [],
          joins: [],
          valueColumn: column.name,
          groupBy: compactUnique([groupColumn?.name]),
          filter: [],
        },
        sourceFiles: [sheet.sourceFileName],
        dimensions: compactUnique([groupColumn?.name]),
        description: `Average ${humanize(column.name)} broken down by ${humanize(groupColumn?.name || "overall")}`,
      });

      metrics.push({
        name: `${slugify(column.name)}_sum`,
        formula: `sum of "${column.name}"${groupColumn ? ` grouped by "${groupColumn.name}"` : ""}`,
        executableSpec: {
          id: `${slugify(column.name)}-sum-${sheet.sourceFileId}`,
          name: `${slugify(column.name)}_sum`,
          type: "sum",
          sourceFile: sheet.sourceFileName,
          joinFiles: [],
          joins: [],
          valueColumn: column.name,
          groupBy: compactUnique([groupColumn?.name]),
          filter: [],
        },
        sourceFiles: [sheet.sourceFileName],
        dimensions: compactUnique([groupColumn?.name]),
        description: `Total ${humanize(column.name)} from ${sheet.sourceFileName}`,
      });
    }

    for (const column of booleanColumns) {
      const groupColumn = groupingColumns[0];
      metrics.push({
        name: `${slugify(column.name)}_rate`,
        formula: `count rows where "${column.name}" = true divided by total rows${groupColumn ? ` grouped by "${groupColumn.name}"` : ""}`,
        executableSpec: {
          id: `${slugify(column.name)}-ratio-${sheet.sourceFileId}`,
          name: `${slugify(column.name)}_rate`,
          type: "ratio",
          sourceFile: sheet.sourceFileName,
          joinFiles: [],
          joins: [],
          groupBy: compactUnique([groupColumn?.name]),
          filter: [],
          numerator: {
            aggregation: "count",
            filter: [
              {
                column: column.name,
                operator: "eq",
                value: true,
              },
            ],
          },
          denominator: {
            aggregation: "count",
            filter: [],
          },
        },
        sourceFiles: [sheet.sourceFileName],
        dimensions: compactUnique([groupColumn?.name]),
        description: `Incidence rate for ${humanize(column.name)}`,
      });
    }

    for (const column of groupingColumns.slice(0, 3)) {
      metrics.push({
        name: `${slugify(column.name)}_cardinality`,
        formula: `count distinct "${column.name}"`,
        executableSpec: {
          id: `${slugify(column.name)}-distinct-${sheet.sourceFileId}`,
          name: `${slugify(column.name)}_cardinality`,
          type: "count_distinct",
          sourceFile: sheet.sourceFileName,
          joinFiles: [],
          joins: [],
          valueColumn: column.name,
          groupBy: [],
          filter: [],
        },
        sourceFiles: [sheet.sourceFileName],
        dimensions: candidateDimensions.slice(0, 3),
        description: `Distinct ${humanize(column.name)} count in ${sheet.sourceFileName}`,
      });
    }
  }

  if (candidateTimeAxes[0]) {
    metrics.push({
      name: "period_over_period_delta",
      formula: `delta over "${candidateTimeAxes[0]}" for the leading numeric measure`,
      executableSpec: {
        id: `period-over-period-delta-${candidateTimeAxes[0]}`,
        name: "period_over_period_delta",
        type: "delta",
        sourceFile: datasetProfile.sheets[0]?.sourceFileName || datasetProfile.sourceFileName,
        joinFiles: [],
        joins: [],
        groupBy: [candidateTimeAxes[0]],
        filter: [],
        timeColumn: candidateTimeAxes[0],
        valueColumn: datasetProfile.sheets.flatMap((sheet) => sheet.columns).find((column) => column.role === "measure")?.name,
      },
      sourceFiles: compactUnique(datasetProfile.sheets.map((sheet) => sheet.sourceFileName)),
      dimensions: compactUnique([candidateTimeAxes[0], candidateDimensions[0]]),
      description: "Period-over-period change for the leading numeric measure",
    });
  }

  return metrics.slice(0, 18);
}

function keywordFallbackDomain(datasetProfile: DatasetProfile, brief: ReportBrief) {
  const haystack = [
    brief.businessContext,
    brief.objective,
    brief.thesis,
    ...datasetProfile.sourceFiles.map((file) => file.fileName),
    ...datasetProfile.sheets.flatMap((sheet) => sheet.columns.map((column) => column.name)),
  ]
    .join(" ")
    .toLowerCase();

  if (haystack.includes("citation") || haystack.includes("query") || haystack.includes("model")) {
    return "AI visibility research";
  }

  if (haystack.includes("revenue") || haystack.includes("share") || haystack.includes("margin")) {
    return "Commercial performance analysis";
  }

  if (haystack.includes("cost") || haystack.includes("opex") || haystack.includes("p&l")) {
    return "Financial performance review";
  }

  return "Structured evidence package analysis";
}

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}
