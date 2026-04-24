type ManifestSlide = {
  position: number;
  title: string;
  body?: string;
  bullets?: string[];
  callout?: { text?: string };
  chartId?: string;
};

type ManifestChart = {
  id: string;
  sourceNote?: string;
};

export type CitationViolation = {
  slideIndex: number;
  rawSourceLine: string;
  citedEntity: string;
  violationType: "unknown-filename" | "unfetched-url" | "fabricated-report-name";
};

export type CitationFidelityReport = {
  violations: CitationViolation[];
  passed: boolean;
};

export function validateCitations(input: {
  manifest: {
    slides: ManifestSlide[];
    charts: ManifestChart[];
  };
  uploadedFileNames: string[];
  fetchedUrls: string[];
}): CitationFidelityReport {
  const chartById = new Map(input.manifest.charts.map((chart) => [chart.id, chart]));
  const uploadedFileNames = new Set(input.uploadedFileNames.map(normalizeText));
  const fetchedUrls = new Set(input.fetchedUrls.map(normalizeUrl));
  const violations: CitationViolation[] = [];

  for (const slide of input.manifest.slides) {
    const sourceLines = extractSourceLines(slide, chartById.get(slide.chartId ?? ""));
    for (const rawSourceLine of sourceLines) {
      const fileMatches = rawSourceLine.match(FILENAME_PATTERN) ?? [];
      const urlMatches = rawSourceLine.match(URL_PATTERN) ?? [];

      for (const fileName of fileMatches) {
        if (!uploadedFileNames.has(normalizeText(fileName))) {
          violations.push({
            slideIndex: slide.position,
            rawSourceLine,
            citedEntity: fileName,
            violationType: "unknown-filename",
          });
        }
      }

      for (const url of urlMatches) {
        if (!fetchedUrls.has(normalizeUrl(url))) {
          violations.push({
            slideIndex: slide.position,
            rawSourceLine,
            citedEntity: url,
            violationType: "unfetched-url",
          });
        }
      }

      if (fileMatches.length === 0 && urlMatches.length === 0) {
        const citedEntity = stripSourcePrefix(rawSourceLine);
        if (citedEntity) {
          violations.push({
            slideIndex: slide.position,
            rawSourceLine,
            citedEntity,
            violationType: "fabricated-report-name",
          });
        }
      }
    }
  }

  return {
    violations,
    passed: violations.length === 0,
  };
}

const SOURCE_LINE_PATTERN = /(?:^|\n)\s*(Fonte:|Source:)\s*([^\n]+)/gi;
const URL_PATTERN = /https?:\/\/[^\s|,)]+/gi;
const FILENAME_PATTERN = /[A-Za-z0-9 _.-]+\.(?:xlsx|xls|csv|pptx|pdf|md|docx?)/gi;

function extractSourceLines(slide: ManifestSlide, chart: ManifestChart | undefined) {
  const lines = new Set<string>();
  const textBlocks = [
    slide.title,
    slide.body ?? "",
    ...(slide.bullets ?? []),
    slide.callout?.text ?? "",
    chart?.sourceNote ?? "",
  ];

  for (const block of textBlocks) {
    if (!block) {
      continue;
    }
    for (const match of block.matchAll(SOURCE_LINE_PATTERN)) {
      if (match[0]?.trim()) {
        lines.add(match[0].trim());
      }
    }
    if (/^(Fonte:|Source:)/i.test(block.trim())) {
      lines.add(block.trim());
    }
  }

  if (chart?.sourceNote?.trim()) {
    lines.add(chart.sourceNote.trim());
  }

  return [...lines];
}

function stripSourcePrefix(value: string) {
  return value.replace(/^(Fonte:|Source:)\s*/i, "").trim();
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function normalizeUrl(value: string) {
  return value
    .trim()
    .replace(/[),.;]+$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}
