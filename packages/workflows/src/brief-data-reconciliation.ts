import { read, utils, type WorkSheet } from "xlsx";

import type { NormalizedWorkbook } from "@basquio/types";

export type SourceEvidenceFile = {
  id: string;
  fileName: string;
  kind: string;
  buffer: Buffer;
};

export type BriefDataReconciliationProfile = {
  briefText: string;
  files: Array<{
    id: string;
    fileName: string;
    kind: string;
  }>;
  detectedYears: number[];
  detectedMeasureGroups: string[];
  sheets: SheetEvidenceProfile[];
  sourceTermCoverage: Array<{
    term: string;
    presentInDimensionValues: boolean;
    presentInFileName: boolean;
    matchedValues: string[];
  }>;
  unsupportedBriefTerms: string[];
};

export type BriefDataReconciliationResult = {
  answerable: "fully" | "partial" | "mismatch";
  supportedScope: string[];
  unsupportedScope: string[];
  entityCorrections: string[];
  forbiddenClaims: string[];
  authorInstructions: string[];
  scopeAdjustmentText: string;
};

type SheetEvidenceProfile = {
  fileName: string;
  sheetName: string;
  rowCount: number;
  columnNames: string[];
  rawHeaderRows: string[][];
  detectedYears: number[];
  detectedMeasureGroups: string[];
  dimensions: Array<{
    name: string;
    values: string[];
    uniqueCount: number;
    omittedCount: number;
  }>;
};

const MAX_HEADER_ROWS = 5;
const MAX_DIMENSION_VALUES = 40;
const MAX_PROMPT_DIMENSION_VALUES = 25;

const BRIEF_ENTITY_STOPWORDS = new Set([
  "analizza",
  "analyze",
  "analysis",
  "audience",
  "brief",
  "business",
  "caffe",
  "categoria",
  "category",
  "chili",
  "client",
  "coffee",
  "contesto",
  "context",
  "crescita",
  "data",
  "dati",
  "deck",
  "euro",
  "executive",
  "global",
  "globali",
  "globale",
  "individuando",
  "market",
  "mercato",
  "mondo",
  "objective",
  "opportunities",
  "opportunita",
  "opportunita",
  "opportunity",
  "report",
  "slide",
  "source",
  "stakeholder",
  "suite",
  "target",
  "trend",
  "trends",
  "valore",
  "value",
  "volume",
  "world",
]);

export function buildBriefDataReconciliationProfile(input: {
  briefText: string;
  files: SourceEvidenceFile[];
  workbook: NormalizedWorkbook;
}): BriefDataReconciliationProfile {
  const rawSheetProfiles = input.files.flatMap((file) => extractRawWorkbookSheetProfiles(file));
  const normalizedSheetProfiles = input.workbook.sheets.map((sheet) => {
    const rawMatch = rawSheetProfiles.find((profile) =>
      profile.fileName === sheet.sourceFileName && profile.sheetName === sheet.name);
    const dimensions = extractNormalizedDimensions(sheet.columns, sheet.rows);
    return {
      fileName: sheet.sourceFileName,
      sheetName: sheet.name,
      rowCount: sheet.rowCount,
      columnNames: sheet.columns.map((column) => column.name),
      rawHeaderRows: rawMatch?.rawHeaderRows ?? [],
      detectedYears: uniqueSortedNumbers([
        ...(rawMatch?.detectedYears ?? []),
        ...sheet.columns.flatMap((column) => extractYears(column.name)),
      ]),
      detectedMeasureGroups: uniqueStrings(rawMatch?.detectedMeasureGroups ?? []),
      dimensions,
    };
  });

  const fallbackRawOnlyProfiles = rawSheetProfiles
    .filter((rawProfile) => !normalizedSheetProfiles.some((profile) =>
      profile.fileName === rawProfile.fileName && profile.sheetName === rawProfile.sheetName))
    .map((rawProfile) => ({
      fileName: rawProfile.fileName,
      sheetName: rawProfile.sheetName,
      rowCount: rawProfile.rowCount,
      columnNames: [],
      rawHeaderRows: rawProfile.rawHeaderRows,
      detectedYears: rawProfile.detectedYears,
      detectedMeasureGroups: rawProfile.detectedMeasureGroups,
      dimensions: [],
    }));

  const sheets = [...normalizedSheetProfiles, ...fallbackRawOnlyProfiles];
  const allDimensionValues = sheets.flatMap((sheet) =>
    sheet.dimensions.flatMap((dimension) => dimension.values));
  const sourceValueIndex = new Map(
    allDimensionValues.map((value) => [normalizeBare(value), value]),
  );
  const fileNameIndex = input.files.map((file) => normalizeForMatch(file.fileName)).join(" ");
  const briefTerms = extractLikelyBriefEntityTerms(input.briefText);
  const sourceTermCoverage = briefTerms.map((term) => {
    const normalizedTerm = normalizeBare(term);
    const matchedValues = [...sourceValueIndex.entries()]
      .filter(([normalizedValue]) => {
        const paddedValue = ` ${normalizedValue} `;
        return normalizedValue === normalizedTerm || paddedValue.includes(` ${normalizedTerm} `);
      })
      .map(([, value]) => value)
      .slice(0, 8);
    return {
      term,
      presentInDimensionValues: matchedValues.length > 0,
      presentInFileName: fileNameIndex.includes(normalizedTerm),
      matchedValues,
    };
  });

  return {
    briefText: input.briefText,
    files: input.files.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      kind: file.kind,
    })),
    detectedYears: uniqueSortedNumbers(sheets.flatMap((sheet) => sheet.detectedYears)),
    detectedMeasureGroups: uniqueStrings(sheets.flatMap((sheet) => sheet.detectedMeasureGroups)),
    sheets,
    sourceTermCoverage,
    unsupportedBriefTerms: sourceTermCoverage
      .filter((coverage) => !coverage.presentInDimensionValues)
      .map((coverage) => coverage.term),
  };
}

export function buildBriefDataReconciliationPrompt(profile: BriefDataReconciliationProfile) {
  return [
    "You audit whether an analyst brief can be answered from an uploaded dataset.",
    "",
    "Return one JSON object matching this schema:",
    "{",
    '  "answerable": "fully" | "partial" | "mismatch",',
    '  "supportedScope": string[],',
    '  "unsupportedScope": string[],',
    '  "entityCorrections": string[],',
    '  "forbiddenClaims": string[],',
    '  "authorInstructions": string[],',
    '  "scopeAdjustmentText": string',
    "}",
    "",
    "Rules:",
    '- "fully" means every analytical question the brief implies can be answered from the uploaded data alone.',
    '- "partial" means the data answers some but not all of the brief implied questions.',
    '- "mismatch" means the data answers a fundamentally different question than what the brief asks.',
    "- The scopeAdjustmentText is mandatory. It will be injected into the deck author prompt.",
    "- Name the gap explicitly, describe what the data does answer, and instruct the author to narrate the gap honestly in the executive summary, methodology, narrative report, workbook, and deck.",
    "- Do not recommend blocking the run. The author must still ship the best honest artifact from the available data.",
    "- Do not add external sources. If external sources are needed but not uploaded, say that they are out of scope.",
    "",
    "Brief:",
    profile.briefText || "(empty brief)",
    "",
    "Dataset evidence profile:",
    JSON.stringify(compactProfileForPrompt(profile), null, 2),
  ].join("\n");
}

export function buildFallbackBriefDataReconciliation(
  profile: BriefDataReconciliationProfile,
  error?: unknown,
): BriefDataReconciliationResult {
  const years = profile.detectedYears;
  const yearText = years.length > 0 ? years.join(", ") : "no explicit years detected";
  const measureText = profile.detectedMeasureGroups.length > 0
    ? profile.detectedMeasureGroups.join(", ")
    : "the numeric measure columns detected by the workbook parser";
  const categoryValues = extractDimensionValuesByName(profile, ["category", "categoria"]);
  const entityColumns = extractDimensionProfilesByName(profile, [
    "brand owner",
    "brand",
    "marca",
    "supplier",
    "fornitore",
    "manufacturer",
    "company",
  ]);
  const absentTerms = profile.sourceTermCoverage.filter((coverage) => !coverage.presentInDimensionValues);
  const supportedScope = [
    `Uploaded workbook scope: ${profile.files.map((file) => `${file.fileName} (${file.kind})`).join(", ") || "uploaded evidence"}.`,
    `Detected period columns: ${yearText}.`,
    `Detected measure groups: ${measureText}.`,
    ...categoryValues.length > 0
      ? [`Source category labels available: ${categoryValues.join(", ")}.`]
      : [],
    ...entityColumns.length > 0
      ? entityColumns.map((dimension) =>
          `Source entity dimension ${dimension.name} includes labels such as ${dimension.values.slice(0, 12).join(", ")}.`)
      : [],
  ];
  const unsupportedScope = [
    ...years.length > 0
      ? [`No source period outside ${yearText} is present in the uploaded workbook.`]
      : [],
    ...categoryValues.length > 0
      ? ["No product or segment split beyond the exact source category labels is present in the uploaded workbook."]
      : [],
    "No external market sources, citations, or benchmarks are present unless they are explicitly included in the uploaded evidence.",
    ...absentTerms.length > 0
      ? [`Brief terms absent from workbook dimension values: ${absentTerms.map((coverage) => coverage.term).join(", ")}.`]
      : [],
    ...(error ? [`The reconciliation model failed, so this deterministic scope contract is being used: ${formatError(error)}.`] : []),
  ];
  const entityCorrections = [
    "Use source labels exactly as workbook labels. Do not rename a brand-owner, supplier, country, category, or segment unless the mapping is explicit in the uploaded data.",
    ...absentTerms.length > 0
      ? absentTerms.map((coverage) =>
          coverage.presentInFileName
            ? `${coverage.term} appears in a file name or brief, but not as a workbook dimension value. Do not invent ${coverage.term} metrics. State that the workbook does not expose that exact label.`
            : `${coverage.term} appears in the brief, but not as a workbook dimension value. Do not invent metrics for it.`)
      : [],
  ];
  const forbiddenClaims = [
    ...years.length > 0
      ? [`Do not claim or create data for years outside ${yearText}.`]
      : [],
    "Do not create extra source rows, period columns, segment labels, market sizes, shares, competitor values, or growth rates that are not computed from the uploaded evidence.",
    "Do not cite Euromonitor, Statista, ICO, web sources, or any other external source unless that source file is uploaded and the exact citation is traceable.",
    "Do not convert a brand-owner, supplier, or company row into a brand-level claim unless the uploaded data explicitly defines that mapping.",
  ];
  const authorInstructions = [
    "Treat this scope adjustment as binding evidence policy before writing any outline, chart, data table, narrative claim, or slide title.",
    "When the brief asks for something the dataset does not support, still ship the artifact, but label the unsupported area as a data gap and pivot to the strongest answer supported by the uploaded workbook.",
    "Every hero number must be computed from source rows in code execution and written to data_tables.xlsx from the same dataframe used in the deck and narrative report.",
  ];

  return {
    answerable: unsupportedScope.length > 0 ? "partial" : "fully",
    supportedScope,
    unsupportedScope,
    entityCorrections,
    forbiddenClaims,
    authorInstructions,
    scopeAdjustmentText: [
      `The uploaded dataset covers ${yearText} with ${measureText}.`,
      categoryValues.length > 0
        ? `Use only these source category labels unless a more detailed split is directly present: ${categoryValues.join(", ")}.`
        : "Use only source labels and computed fields directly present in the uploaded evidence.",
      absentTerms.length > 0
        ? `The brief mentions ${absentTerms.map((coverage) => coverage.term).join(", ")}, but those exact terms are not present as workbook dimension values. Do not invent metrics for them; explain the limitation and use the nearest explicit source dimension only if the workbook itself defines it.`
        : "Do not create unsupported entity or segment mappings.",
      "Do not use external citations or benchmarks unless they were uploaded as evidence. Narrate unsupported brief scope as a data gap, then build the best honest deck from the source workbook.",
    ].join(" "),
  };
}

export function parseBriefDataReconciliationResponse(
  text: string,
  fallback: BriefDataReconciliationResult,
): BriefDataReconciliationResult {
  const parsed = parseFirstJsonObject(text);
  if (!parsed || typeof parsed !== "object") {
    return fallback;
  }

  const record = parsed as Record<string, unknown>;
  const answerable = record.answerable === "fully" || record.answerable === "partial" || record.answerable === "mismatch"
    ? record.answerable
    : fallback.answerable;
  const parsedScopeAdjustment = typeof record.scopeAdjustmentText === "string"
    ? record.scopeAdjustmentText
    : typeof record.scopeAdjustment === "string"
      ? record.scopeAdjustment
      : "";
  const parsedUnsupportedScope = stringArray(record.unsupportedScope);
  const unsupportedTerms = extractUnsupportedTerms([
    ...fallback.unsupportedScope,
    ...fallback.entityCorrections,
    ...parsedUnsupportedScope,
  ]);

  return {
    answerable,
    supportedScope: mergeUnique(
      fallback.supportedScope,
      filterSupportedScopeAgainstUnsupportedTerms(stringArray(record.supportedScope), unsupportedTerms),
    ),
    unsupportedScope: mergeUnique(fallback.unsupportedScope, parsedUnsupportedScope),
    entityCorrections: mergeUnique(fallback.entityCorrections, stringArray(record.entityCorrections)),
    forbiddenClaims: mergeUnique(fallback.forbiddenClaims, stringArray(record.forbiddenClaims)),
    authorInstructions: mergeUnique(fallback.authorInstructions, stringArray(record.authorInstructions)),
    scopeAdjustmentText: parsedScopeAdjustment.trim().length > 40
      ? `${fallback.scopeAdjustmentText}\n\nModel reconciliation: ${parsedScopeAdjustment.trim()}`
      : fallback.scopeAdjustmentText,
  };
}

export function formatScopeAdjustmentForAuthor(result: BriefDataReconciliationResult) {
  const lines = [
    "<scope_adjustment>",
    "Brief-data reconciliation, mandatory evidence contract:",
    `Answerability: ${result.answerable}.`,
    "Supported source scope:",
    ...result.supportedScope.map((item) => `- ${item}`),
    "Unsupported or not-proven scope:",
    ...result.unsupportedScope.map((item) => `- ${item}`),
    "Entity and label rules:",
    ...result.entityCorrections.map((item) => `- ${item}`),
    "Forbidden claims:",
    ...result.forbiddenClaims.map((item) => `- ${item}`),
    "Author instructions:",
    ...result.authorInstructions.map((item) => `- ${item}`),
    "Scope adjustment text:",
    result.scopeAdjustmentText,
    "</scope_adjustment>",
  ];

  return lines.join("\n");
}

function extractRawWorkbookSheetProfiles(file: SourceEvidenceFile): SheetEvidenceProfile[] {
  if (file.kind !== "workbook") {
    return [];
  }

  try {
    const workbook = read(file.buffer, { type: "buffer" });
    return workbook.SheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName]!;
      const rows = worksheetToRowsWithMergeFill(worksheet);
      const rawHeaderRows = rows.slice(0, MAX_HEADER_ROWS).map((row) => row.map(stringifyCell));
      const detectedYears = uniqueSortedNumbers(rawHeaderRows.flatMap((row) => row.flatMap(extractYears)));
      const detectedMeasureGroups = detectMeasureGroups(rawHeaderRows);
      return {
        fileName: file.fileName,
        sheetName,
        rowCount: Math.max(0, rows.length - 1),
        columnNames: [],
        rawHeaderRows,
        detectedYears,
        detectedMeasureGroups,
        dimensions: [],
      };
    });
  } catch {
    return [];
  }
}

function worksheetToRowsWithMergeFill(worksheet: WorkSheet): unknown[][] {
  const rows = utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: false,
  });
  const filledRows = rows.map((row) => [...row]);
  const merges = worksheet["!merges"] ?? [];
  for (const merge of merges) {
    const value = filledRows[merge.s.r]?.[merge.s.c] ?? null;
    for (let rowIndex = merge.s.r; rowIndex <= merge.e.r; rowIndex += 1) {
      while ((filledRows[rowIndex] ??= []).length <= merge.e.c) {
        filledRows[rowIndex]!.push(null);
      }
      for (let columnIndex = merge.s.c; columnIndex <= merge.e.c; columnIndex += 1) {
        filledRows[rowIndex]![columnIndex] = value;
      }
    }
  }
  return filledRows;
}

function extractNormalizedDimensions(
  columns: NormalizedWorkbook["sheets"][number]["columns"],
  rows: NormalizedWorkbook["sheets"][number]["rows"],
): SheetEvidenceProfile["dimensions"] {
  return columns
    .filter((column) => isDimensionLikeColumn(column.name, column.role))
    .slice(0, 12)
    .map((column) => {
      const counts = new Map<string, number>();
      for (const row of rows) {
        const value = stringifyCell(row[column.name]).trim();
        if (!value || value.length > 90 || looksNumeric(value)) {
          continue;
        }
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      const values = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([value]) => value);
      return {
        name: column.name,
        values: values.slice(0, MAX_DIMENSION_VALUES),
        uniqueCount: values.length,
        omittedCount: Math.max(0, values.length - MAX_DIMENSION_VALUES),
      };
    })
    .filter((dimension) => dimension.values.length > 0);
}

function isDimensionLikeColumn(name: string, role: string) {
  const normalizedName = normalizeForMatch(name);
  if (!normalizedName || extractYears(name).length > 0 || looksNumeric(name)) {
    return false;
  }
  if (role === "measure") {
    return false;
  }
  return true;
}

function detectMeasureGroups(rawHeaderRows: string[][]) {
  const groups: string[] = [];
  for (let rowIndex = 1; rowIndex < rawHeaderRows.length; rowIndex += 1) {
    const row = rawHeaderRows[rowIndex] ?? [];
    const previousRow = rawHeaderRows[rowIndex - 1] ?? [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      if (extractYears(row[columnIndex] ?? "").length === 0) {
        continue;
      }
      const directGroup = previousRow[columnIndex] ?? "";
      if (directGroup && extractYears(directGroup).length === 0 && !looksNumeric(directGroup)) {
        groups.push(directGroup);
      }
    }
  }
  return uniqueStrings(groups);
}

function extractDimensionValuesByName(profile: BriefDataReconciliationProfile, names: string[]) {
  const matches = extractDimensionProfilesByName(profile, names);
  return uniqueStrings(matches.flatMap((dimension) => dimension.values)).slice(0, 18);
}

function extractDimensionProfilesByName(profile: BriefDataReconciliationProfile, names: string[]) {
  return profile.sheets
    .flatMap((sheet) => sheet.dimensions)
    .filter((dimension) => {
      const normalizedName = normalizeForMatch(dimension.name);
      return names.some((name) => normalizedName.includes(normalizeForMatch(name)));
    });
}

function compactProfileForPrompt(profile: BriefDataReconciliationProfile) {
  return {
    files: profile.files,
    detectedYears: profile.detectedYears,
    detectedMeasureGroups: profile.detectedMeasureGroups,
    sourceTermCoverage: profile.sourceTermCoverage,
    sheets: profile.sheets.map((sheet) => ({
      fileName: sheet.fileName,
      sheetName: sheet.sheetName,
      rowCount: sheet.rowCount,
      columnNames: sheet.columnNames.slice(0, 24),
      rawHeaderRows: sheet.rawHeaderRows,
      detectedYears: sheet.detectedYears,
      detectedMeasureGroups: sheet.detectedMeasureGroups,
      dimensions: sheet.dimensions.map((dimension) => ({
        name: dimension.name,
        uniqueCount: dimension.uniqueCount,
        values: dimension.values.slice(0, MAX_PROMPT_DIMENSION_VALUES),
        omittedCount: Math.max(0, dimension.uniqueCount - MAX_PROMPT_DIMENSION_VALUES),
      })),
    })),
  };
}

function extractLikelyBriefEntityTerms(text: string) {
  const tokens = new Set<string>();
  for (const rawToken of text.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9&.'-]{2,}/g) ?? []) {
    const token = rawToken.trim();
    const normalized = normalizeBare(token);
    if (
      token.length < 4 ||
      BRIEF_ENTITY_STOPWORDS.has(normalized) ||
      normalized.includes(" ") ||
      extractYears(token).length > 0
    ) {
      continue;
    }
    tokens.add(token);
  }
  return [...tokens].slice(0, 16);
}

function normalizeForMatch(value: string) {
  return ` ${normalizeBare(value)} `;
}

function normalizeBare(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stringifyCell(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }
  return String(value).trim();
}

function looksNumeric(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return /^[-+]?[\d,.% ]+$/.test(trimmed);
}

function extractYears(value: string) {
  return [...String(value).matchAll(/\b(19\d{2}|20\d{2})\b/g)]
    .map((match) => Number(match[1]))
    .filter((year) => Number.isInteger(year) && year >= 1900 && year <= 2099);
}

function uniqueSortedNumbers(values: number[]) {
  return [...new Set(values.filter((value) => Number.isFinite(value)))]
    .sort((a, b) => a - b);
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map((entry) => entry.trim()).filter(Boolean)) {
    const key = normalizeForMatch(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function mergeUnique(first: string[], second: string[]) {
  return uniqueStrings([...first, ...second]);
}

function filterSupportedScopeAgainstUnsupportedTerms(items: string[], unsupportedTerms: string[]) {
  if (unsupportedTerms.length === 0) {
    return items;
  }

  return items.filter((item) => {
    const normalized = normalizeBare(item);
    if (!unsupportedTerms.some((term) => normalized.includes(normalizeBare(term)))) {
      return true;
    }

    return /\b(absent|not present|not found|does not contain|missing|unsupported|gap)\b/i.test(item);
  });
}

function extractUnsupportedTerms(lines: string[]) {
  const terms = new Set<string>();
  for (const line of lines) {
    const absentMatch = line.match(/Brief terms absent from workbook dimension values:\s*([^.]*)/i);
    if (absentMatch?.[1]) {
      for (const term of absentMatch[1].split(",")) {
        const trimmed = term.trim();
        if (trimmed) {
          terms.add(trimmed);
        }
      }
    }

    const briefMatch = line.match(/^([A-Za-zÀ-ÿ0-9&.' -]{3,60}) appears in the brief/i);
    if (briefMatch?.[1]) {
      terms.add(briefMatch[1].trim());
    }
  }

  return [...terms];
}

function parseFirstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
}
