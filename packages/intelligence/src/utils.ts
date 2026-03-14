import type {
  DatasetProfile,
  EvidenceRef,
  InsightSpec,
  NormalizedWorkbook,
  ReportBrief,
} from "@basquio/types";

export function profileDataset(datasetProfile: DatasetProfile) {
  const warnings = [...datasetProfile.warnings];

  if ((datasetProfile.manifest?.files.length ?? 0) > 1) {
    warnings.push(`Evidence package includes ${datasetProfile.manifest?.files.length ?? 0} files across tabular and support roles.`);
  }

  return {
    ...datasetProfile,
    warnings: compactUnique(warnings),
  };
}

export function buildEvidenceId(input: {
  sourceFileId?: string;
  fileName?: string;
  sheet: string;
  metric: string;
  suffix?: string;
}) {
  return [input.sourceFileId || input.fileName || "dataset", input.sheet, input.metric, input.suffix]
    .filter(Boolean)
    .join(":")
    .replace(/[^a-zA-Z0-9:_-]/g, "-");
}

export function compactUnique(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

export function round(value: unknown, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }

  return value.toFixed(digits);
}

export function cleanFragment(value: string) {
  return value.replace(/\.$/, "").trim();
}

export function getBusinessInsights(insights: InsightSpec[]) {
  return insights
    .filter((insight) => insight.slideEmphasis !== "detail")
    .sort((left, right) => left.rank - right.rank);
}

export function collectInsightEvidenceIds(insights: InsightSpec[]) {
  return compactUnique(
    insights.flatMap((insight) => [
      ...insight.evidenceRefIds,
      ...insight.evidence.map((evidence) => evidence.id),
      ...insight.claims.flatMap((claim) => claim.evidenceIds),
    ]),
  );
}

export function getSupportText(workbook: NormalizedWorkbook, role: "methodology-guide" | "definitions-guide") {
  return workbook.files
    .filter((file) => file.role === role && typeof file.textContent === "string")
    .map((file) => file.textContent?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n\n")
    .slice(0, 5000);
}

export function makeNarrativeTitle(brief: ReportBrief, fallback: string) {
  if (brief.client && brief.objective) {
    return `${brief.client}: ${brief.objective}`;
  }

  if (brief.client) {
    return `${brief.client} report`;
  }

  return fallback;
}

export function findDimensionColumns(datasetProfile: DatasetProfile) {
  return compactUnique(
    datasetProfile.sheets.flatMap((sheet) =>
      sheet.columns
        .filter((column) => column.role === "dimension" || column.role === "segment")
        .map((column) => column.name),
    ),
  );
}

export function findTimeColumns(datasetProfile: DatasetProfile) {
  return compactUnique(
    datasetProfile.sheets.flatMap((sheet) =>
      sheet.columns.filter((column) => column.role === "time").map((column) => column.name),
    ),
  );
}

export function scoreEvidence(evidenceRefs: EvidenceRef[]) {
  return Math.max(
    0.4,
    Math.min(
      0.95,
      evidenceRefs.reduce((total, evidence) => total + evidence.confidence, 0) / Math.max(1, evidenceRefs.length),
    ),
  );
}
