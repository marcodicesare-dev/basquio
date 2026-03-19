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

export function sanitizeAudienceCopy(value?: string) {
  if (!value) {
    return "";
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  if (
    /(reviewer feedback|review feedback|semantic critique|qa\/|qa |quality assurance|pipeline|stage trace|deterministic|evidence ref|re-plan|rendering weak claims|system thesis)/i.test(
      normalized,
    )
  ) {
    return "";
  }

  return normalized;
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

export function matchColumnName(name: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(name));
}

/** @deprecated Legacy v1 retail/FMCG logic. Not used by v2 pipeline. */
export function isRetailMarketDataset(datasetProfile: DatasetProfile, brief?: ReportBrief) {
  const haystack = [
    brief?.businessContext,
    brief?.objective,
    brief?.thesis,
    ...datasetProfile.sheets.flatMap((sheet) => sheet.columns.map((column) => column.name)),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    /(fornitore|marca|mercato_ecr4|famiglia_ecr3|comparto_ecr2)/.test(haystack) &&
    /(v\.?\s*valore|nielseniq|retail measurement|pet care|fmcg|market)/.test(haystack)
  );
}

export function extractRequestedSlideCount(brief: ReportBrief, fallback = 12) {
  const haystack = [brief.objective, brief.businessContext, brief.thesis, brief.stakes]
    .filter(Boolean)
    .join(" ");
  // Match numeric ("5 slides") and word ("one slide") patterns
  const numMatch = haystack.match(/\b(\d{1,3})\s*[- ]?(?:slide|slides)\b/i);
  const wordMatch = haystack.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*[- ]?(?:slide|slides)\b/i);
  const wordToNum: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

  const requested = numMatch
    ? Number(numMatch[1])
    : wordMatch
      ? wordToNum[wordMatch[1].toLowerCase()] ?? fallback
      : fallback;

  if (!Number.isFinite(requested) || requested < 1) {
    return fallback;
  }

  // Respect the user's explicit request — no minimum clamp.
  // Only cap at 100 to prevent runaway generation.
  return Math.min(100, requested);
}
