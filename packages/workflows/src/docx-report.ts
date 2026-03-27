import JSZip from "jszip";

import type { DeckManifest } from "./deck-manifest";

type NarrativeRunContext = {
  client: string;
  audience: string;
  objective: string;
  thesis: string;
  stakes: string;
  business_context: string;
};

type NarrativeMetric = {
  label: string;
  value: string;
  delta?: string;
};

type NarrativeSlide = {
  position: number;
  title: string;
  subtitle?: string;
  body?: string;
  bullets?: string[];
  metrics?: NarrativeMetric[];
  callout?: {
    text: string;
  };
  chartId?: string;
};

type NarrativeAnalysis = {
  language?: string;
  thesis?: string;
  executiveSummary?: string;
  slidePlan?: NarrativeSlide[];
};

type ReportSection = {
  heading: string;
  level: 1 | 2;
  blocks: ReportBlock[];
};

type ReportBlock =
  | {
    kind: "paragraph";
    text: string;
    style?: "Body" | "Meta";
  }
  | {
    kind: "table";
    title?: string;
    headers: [string, string, string];
    rows: Array<[string, string, string]>;
  };

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function buildNarrativeDocx(input: {
  run: NarrativeRunContext;
  analysis: NarrativeAnalysis;
  manifest: DeckManifest;
  generatedAt?: Date;
}) {
  const labels = getLabels(resolveNarrativeLanguage(input));
  const reportTitle = firstNonEmpty(
    input.manifest.slides[0]?.title,
    input.analysis.thesis,
    input.run.objective,
    labels.defaultTitle,
  );
  const generatedAt = input.generatedAt ?? new Date();
  const analysisSlidesByPosition = new Map(
    (input.analysis.slidePlan ?? []).map((slide) => [slide.position, slide]),
  );
  const findingSlides = input.manifest.slides.filter((slide) => slide.position > 1);
  const recommendationSlides = pickRecommendationSlides(findingSlides);
  const evidenceNotes = collectEvidenceNotes(input.manifest);

  const sections: ReportSection[] = [
    {
      heading: labels.executiveSummary,
      level: 1,
      blocks: buildExecutiveSummaryBlocks(input, labels),
    },
    {
      heading: labels.context,
      level: 1,
      blocks: paragraphBlocks([
        buildContextParagraph(input.run, labels),
        buildAudienceParagraph(input.run, labels),
        buildStakesParagraph(input.run, labels),
      ]),
    },
    {
      heading: labels.findings,
      level: 1,
      blocks: paragraphBlocks([labels.findingsIntro]),
    },
    ...findingSlides.map((slide) => {
      const fallbackSlide = analysisSlidesByPosition.get(slide.position);
      const mergedSlide = mergeSlideNarrative(slide, fallbackSlide);
      return {
        heading: mergedSlide.title,
        level: 2 as const,
        blocks: buildSlideBlocks(mergedSlide, labels),
      };
    }),
  ];

  if (recommendationSlides.length > 0) {
    sections.push({
      heading: labels.recommendations,
      level: 1,
      blocks: paragraphBlocks([labels.recommendationsIntro]),
    });
    sections.push(
      ...recommendationSlides.map((slide) => ({
        heading: slide.title,
        level: 2 as const,
        blocks: buildRecommendationBlocks(slide, labels),
      })),
    );
  }

  if (evidenceNotes.length > 0) {
    sections.push({
      heading: labels.evidenceNotes,
      level: 1,
      blocks: paragraphBlocks(evidenceNotes),
    });
  }

  const zip = new JSZip();
  zip.file("[Content_Types].xml", buildContentTypesXml());
  zip.file("_rels/.rels", buildRootRelationshipsXml());
  zip.file("docProps/core.xml", buildCorePropsXml(reportTitle, generatedAt));
  zip.file("docProps/app.xml", buildAppPropsXml());
  zip.file("word/document.xml", buildDocumentXml({
    title: reportTitle,
    labels,
    run: input.run,
    generatedAt,
    sections,
  }));
  zip.file("word/styles.xml", buildStylesXml(labels));
  zip.file("word/_rels/document.xml.rels", buildDocumentRelationshipsXml());

  return {
    fileId: `generated-docx-${generatedAt.getTime()}`,
    fileName: "report.docx",
    mimeType: DOCX_MIME_TYPE,
    buffer: await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    }),
  };
}

function buildDocumentXml(input: {
  title: string;
  labels: ReturnType<typeof getLabels>;
  run: NarrativeRunContext;
  generatedAt: Date;
  sections: ReportSection[];
}) {
  const body = [
    paragraphXml(input.title, "Title"),
    paragraphXml(`${input.labels.preparedFor}: ${firstNonEmpty(input.run.client, extractClientHint(input.run.business_context), input.labels.unknownValue)}`, "Subtitle"),
    paragraphXml(`${input.labels.objectiveLabel}: ${firstNonEmpty(input.run.objective, input.labels.unknownValue)}`, "Meta"),
    paragraphXml(`${input.labels.audienceLabel}: ${firstNonEmpty(input.run.audience, input.labels.unknownValue)}`, "Meta"),
    paragraphXml(`${input.labels.generatedOnLabel}: ${formatDate(input.generatedAt)}`, "Meta"),
    ...input.sections.flatMap((section) => [
      paragraphXml(section.heading, section.level === 1 ? "Heading1" : "Heading2"),
      ...section.blocks.map((block) => blockXml(block)),
    ]),
    sectionPropertiesXml(),
  ].join("");

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    "<w:body>",
    body,
    "</w:body>",
    "</w:document>",
  ].join("");
}

function buildContentTypesXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    "</Types>",
  ].join("");
}

function buildRootRelationshipsXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
    "</Relationships>",
  ].join("");
}

function buildDocumentRelationshipsXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    "</Relationships>",
  ].join("");
}

function buildCorePropsXml(title: string, generatedAt: Date) {
  const iso = generatedAt.toISOString();
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `<dc:title>${escapeXml(title)}</dc:title>`,
    "<dc:creator>Basquio</dc:creator>",
    "<cp:lastModifiedBy>Basquio</cp:lastModifiedBy>",
    `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created>`,
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified>`,
    "</cp:coreProperties>",
  ].join("");
}

function buildAppPropsXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">',
    "<Application>Basquio</Application>",
    "</Properties>",
  ].join("");
}

function buildStylesXml(labels: ReturnType<typeof getLabels>) {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:lang w:val="',
    labels.wordLanguage,
    '"/></w:rPr></w:rPrDefault></w:docDefaults>',
    styleXml("Normal", "Normal", {
      paragraph: '<w:spacing w:after="160" w:line="300" w:lineRule="auto"/>',
      run: '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="1F2933"/><w:sz w:val="22"/>',
      defaultStyle: true,
    }),
    styleXml("Title", "Title", {
      basedOn: "Normal",
      paragraph: '<w:spacing w:before="120" w:after="240"/>',
      run: '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="111827"/><w:sz w:val="34"/>',
    }),
    styleXml("Subtitle", "Subtitle", {
      basedOn: "Normal",
      paragraph: '<w:spacing w:after="120"/>',
      run: '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="4B5563"/><w:sz w:val="24"/>',
    }),
    styleXml("Meta", "Meta", {
      basedOn: "Normal",
      paragraph: '<w:spacing w:after="80"/>',
      run: '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="6B7280"/><w:sz w:val="18"/>',
    }),
    styleXml("Heading1", "Heading 1", {
      basedOn: "Normal",
      paragraph: '<w:spacing w:before="240" w:after="120"/>',
      run: '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="111827"/><w:sz w:val="28"/>',
    }),
    styleXml("Heading2", "Heading 2", {
      basedOn: "Normal",
      paragraph: '<w:spacing w:before="180" w:after="80"/>',
      run: '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="1F2937"/><w:sz w:val="24"/>',
    }),
    styleXml("Body", "Body", {
      basedOn: "Normal",
      paragraph: '<w:spacing w:after="160" w:line="300" w:lineRule="auto"/>',
      run: '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="1F2933"/><w:sz w:val="22"/>',
    }),
    "</w:styles>",
  ].join("");
}

function styleXml(
  styleId: string,
  name: string,
  input: {
    basedOn?: string;
    paragraph?: string;
    run?: string;
    defaultStyle?: boolean;
  },
) {
  return [
    `<w:style w:type="paragraph" w:styleId="${styleId}"${input.defaultStyle ? ' w:default="1"' : ""}>`,
    `<w:name w:val="${escapeXml(name)}"/>`,
    input.basedOn ? `<w:basedOn w:val="${input.basedOn}"/>` : "",
    "<w:qFormat/>",
    `<w:pPr>${input.paragraph ?? ""}</w:pPr>`,
    `<w:rPr>${input.run ?? ""}</w:rPr>`,
    "</w:style>",
  ].join("");
}

function paragraphXml(text: string, styleId: string) {
  return [
    "<w:p>",
    `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>`,
    "<w:r>",
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t>`,
    "</w:r>",
    "</w:p>",
  ].join("");
}

function blockXml(block: ReportBlock) {
  if (block.kind === "paragraph") {
    return paragraphXml(block.text, block.style ?? "Body");
  }

  const title = block.title ? paragraphXml(block.title, "Meta") : "";
  return `${title}${tableXml(block.headers, block.rows)}`;
}

function tableXml(headers: [string, string, string], rows: Array<[string, string, string]>) {
  const columnWidths = ["4200", "2200", "1800"];
  const headerRow = tableRowXml(headers, true, columnWidths);
  const bodyRows = rows.map((row) => tableRowXml(row, false, columnWidths)).join("");

  return [
    "<w:tbl>",
    '<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>',
    '<w:top w:val="single" w:sz="8" w:space="0" w:color="D1D5DB"/>',
    '<w:left w:val="single" w:sz="8" w:space="0" w:color="D1D5DB"/>',
    '<w:bottom w:val="single" w:sz="8" w:space="0" w:color="D1D5DB"/>',
    '<w:right w:val="single" w:sz="8" w:space="0" w:color="D1D5DB"/>',
    '<w:insideH w:val="single" w:sz="6" w:space="0" w:color="E5E7EB"/>',
    '<w:insideV w:val="single" w:sz="6" w:space="0" w:color="E5E7EB"/>',
    "</w:tblBorders></w:tblPr>",
    `<w:tblGrid>${columnWidths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>`,
    headerRow,
    bodyRows,
    "</w:tbl>",
  ].join("");
}

function tableRowXml(cells: [string, string, string], header: boolean, widths: string[]) {
  return `<w:tr>${cells.map((cell, index) => tableCellXml(cell, widths[index] ?? "2400", header)).join("")}</w:tr>`;
}

function tableCellXml(text: string, width: string, header: boolean) {
  const run = header
    ? '<w:rPr><w:b/><w:color w:val="111827"/><w:sz w:val="20"/></w:rPr>'
    : '<w:rPr><w:color w:val="1F2933"/><w:sz w:val="20"/></w:rPr>';
  const shading = header ? '<w:shd w:val="clear" w:color="auto" w:fill="F9FAFB"/>' : "";

  return [
    "<w:tc>",
    `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shading}<w:tcMar><w:top w:w="90" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>`,
    "<w:p>",
    '<w:pPr><w:spacing w:after="40"/></w:pPr>',
    "<w:r>",
    run,
    `<w:t xml:space="preserve">${escapeXml(text || " ")}</w:t>`,
    "</w:r>",
    "</w:p>",
    "</w:tc>",
  ].join("");
}

function sectionPropertiesXml() {
  return [
    "<w:sectPr>",
    '<w:pgSz w:w="12240" w:h="15840"/>',
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>',
    "</w:sectPr>",
  ].join("");
}

function buildExecutiveSummaryBlocks(
  input: {
    run: NarrativeRunContext;
    analysis: NarrativeAnalysis;
    manifest: DeckManifest;
  },
  labels: ReturnType<typeof getLabels>,
) {
  const keyFindingTitles = input.manifest.slides
    .filter((slide) => slide.position > 1)
    .slice(0, 3)
    .map((slide) => normalizeSentence(slide.title));

  const bridgeParagraph = keyFindingTitles.length > 0
    ? `${labels.summaryBridgeIntro} ${joinHumanList(keyFindingTitles, labels)}.`
    : "";

  return paragraphBlocks([
    firstNonEmpty(input.analysis.executiveSummary, input.analysis.thesis),
    bridgeParagraph,
  ]);
}

function buildSlideBlocks(slide: NarrativeSlide, labels: ReturnType<typeof getLabels>) {
  const blocks: ReportBlock[] = [];
  const lead = buildLeadParagraph(slide, labels);
  if (lead) {
    blocks.push({ kind: "paragraph", text: lead });
  }

  const metricTable = buildMetricTable(slide, labels);
  if (metricTable) {
    blocks.push(metricTable);
  }

  const commentary = buildCommentaryParagraph(slide, labels);
  if (commentary) {
    blocks.push({ kind: "paragraph", text: commentary });
  }

  if (slide.callout?.text) {
    blocks.push({
      kind: "paragraph",
      text: `${labels.implicationLabel}: ${normalizeSentence(slide.callout.text)}.`,
    });
  }

  return dedupeBlocks(blocks);
}

function buildRecommendationBlocks(slide: NarrativeSlide, labels: ReturnType<typeof getLabels>) {
  const blocks: ReportBlock[] = [];
  const lead = buildRecommendationLeadParagraph(slide, labels);
  if (lead) {
    blocks.push({ kind: "paragraph", text: lead });
  }

  const metricTable = buildMetricTable(slide, labels);
  if (metricTable) {
    blocks.push(metricTable);
  }

  const why = buildRecommendationWhyParagraph(slide, labels);
  if (why) {
    blocks.push({ kind: "paragraph", text: why });
  }

  const how = buildRecommendationHowParagraph(slide, labels);
  if (how) {
    blocks.push({ kind: "paragraph", text: how });
  }

  return dedupeBlocks(blocks);
}

function mergeSlideNarrative(primary: NarrativeSlide, fallback?: NarrativeSlide) {
  return {
    ...fallback,
    ...primary,
    title: firstNonEmpty(primary.title, fallback?.title),
    subtitle: firstNonEmpty(primary.subtitle, fallback?.subtitle),
    body: firstNonEmpty(primary.body, fallback?.body),
    bullets: primary.bullets && primary.bullets.length > 0 ? primary.bullets : fallback?.bullets,
    metrics: primary.metrics && primary.metrics.length > 0 ? primary.metrics : fallback?.metrics,
    callout: primary.callout?.text ? primary.callout : fallback?.callout,
  };
}

function buildContextParagraph(run: NarrativeRunContext, labels: ReturnType<typeof getLabels>) {
  return compactParagraphs([
    firstNonEmpty(run.objective) ? `${labels.objectiveLabel}: ${run.objective}.` : "",
    firstNonEmpty(run.business_context) ? `${labels.businessContextLabel}: ${run.business_context}.` : "",
    firstNonEmpty(run.thesis) ? `${labels.thesisLabel}: ${run.thesis}.` : "",
  ]).join(" ");
}

function buildAudienceParagraph(run: NarrativeRunContext, labels: ReturnType<typeof getLabels>) {
  if (!firstNonEmpty(run.audience, run.client)) {
    return "";
  }
  return compactParagraphs([
    firstNonEmpty(run.client) ? `${labels.clientLabel}: ${run.client}.` : "",
    firstNonEmpty(run.audience) ? `${labels.audienceLabel}: ${run.audience}.` : "",
  ]).join(" ");
}

function buildStakesParagraph(run: NarrativeRunContext, labels: ReturnType<typeof getLabels>) {
  return firstNonEmpty(run.stakes) ? `${labels.stakesLabel}: ${run.stakes}.` : "";
}

function buildLeadParagraph(slide: NarrativeSlide, labels: ReturnType<typeof getLabels>) {
  const body = firstNonEmpty(slide.body);
  const subtitle = firstNonEmpty(slide.subtitle);

  if (body) {
    return `${normalizeSentence(body)}.`;
  }

  if (subtitle) {
    return `${normalizeSentence(subtitle)}.`;
  }

  const bulletSummary = summarizeBullets(slide.bullets, labels);
  if (bulletSummary) {
    return `${bulletSummary}.`;
  }

  return "";
}

function buildCommentaryParagraph(slide: NarrativeSlide, labels: ReturnType<typeof getLabels>) {
  const bulletSummary = summarizeBullets(slide.bullets, labels);
  if (bulletSummary) {
    return `${labels.readingLabel}: ${bulletSummary}.`;
  }

  if (slide.metrics && slide.metrics.length > 0 && slide.chartId) {
    return labels.metricTableBridge;
  }

  return "";
}

function buildRecommendationLeadParagraph(slide: NarrativeSlide, labels: ReturnType<typeof getLabels>) {
  const callout = firstNonEmpty(slide.callout?.text);
  const body = firstNonEmpty(slide.body);

  if (callout) {
    return `${labels.whatToDoLabel}: ${normalizeSentence(callout)}.`;
  }

  if (body) {
    return `${normalizeSentence(body)}.`;
  }

  return "";
}

function buildRecommendationWhyParagraph(slide: NarrativeSlide, labels: ReturnType<typeof getLabels>) {
  const sources = compactParagraphs([
    firstNonEmpty(slide.body),
    slide.metrics && slide.metrics.length > 0 ? buildMetricSentence(slide.metrics, labels) : "",
  ]);

  if (sources.length === 0) {
    return "";
  }

  return `${labels.whyItMattersLabel}: ${sources.join(" ")}`;
}

function buildRecommendationHowParagraph(slide: NarrativeSlide, labels: ReturnType<typeof getLabels>) {
  const bulletSummary = summarizeBullets(slide.bullets, labels);
  if (!bulletSummary) {
    return "";
  }
  return `${labels.howToActLabel}: ${bulletSummary}.`;
}

function buildMetricTable(slide: NarrativeSlide, labels: ReturnType<typeof getLabels>): ReportBlock | null {
  const usableMetrics = sanitizeMetrics(slide.metrics);
  if (usableMetrics.length < 2) {
    return null;
  }

  return {
    kind: "table",
    title: labels.metricTableTitle,
    headers: [labels.metricColumnLabel, labels.valueColumnLabel, labels.changeColumnLabel],
    rows: usableMetrics.map((metric) => [
      normalizeSentence(metric.label),
      metric.value,
      metric.delta ?? labels.notAvailable,
    ]),
  };
}

function buildMetricSentence(metrics: NarrativeMetric[], labels: ReturnType<typeof getLabels>) {
  const leadMetrics = sanitizeMetrics(metrics).slice(0, 3).map(formatMetric);
  if (leadMetrics.length === 0) {
    return "";
  }
  return `${labels.keyNumbers}: ${leadMetrics.join("; ")}.`;
}

function sanitizeMetrics(metrics: NarrativeMetric[] | undefined) {
  if (!metrics) {
    return [];
  }

  return metrics
    .map((metric) => ({
      ...metric,
      label: normalizeSentence(metric.label),
      value: normalizeSentence(metric.value),
      delta: normalizeSentence(metric.delta ?? ""),
    }))
    .filter((metric) => {
      if (!metric.label || !metric.value) {
        return false;
      }
      if (/^metric\s*\d+$/i.test(metric.label)) {
        return false;
      }
      if (/^(n\/a|n\.d\.|na|-|—)$/i.test(metric.value)) {
        return false;
      }
      return true;
    })
    .map((metric) => ({
      ...metric,
      delta: metric.delta && /^(n\/a|n\.d\.|na|-|—)$/i.test(metric.delta) ? undefined : metric.delta || undefined,
    }));
}

function collectEvidenceNotes(manifest: DeckManifest) {
  const chartTitleById = new Map(manifest.charts.map((chart) => [chart.id, chart.title]));
  const notes = manifest.charts
    .map((chart) => chart.sourceNote?.trim())
    .filter((note): note is string => Boolean(note));
  const slideNotes = manifest.slides
    .filter((slide) => slide.chartId)
    .map((slide) => {
      const chart = manifest.charts.find((candidate) => candidate.id === slide.chartId);
      const sourceNote = chart?.sourceNote?.trim();
      if (!sourceNote) {
        return "";
      }
      return `${slide.title}: ${sourceNote}`;
    });

  return compactParagraphs([...slideNotes, ...notes.map((note) => {
    const matchingTitle = [...chartTitleById.values()].find((title) => note.includes(title));
    return matchingTitle ? `${matchingTitle}: ${note}` : note;
  })]).slice(0, 8);
}

function pickRecommendationSlides(slides: NarrativeSlide[]) {
  const scored = slides
    .map((slide) => ({
      slide,
      score: recommendationScore(slide),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    return scored.slice(0, 3).map((entry) => entry.slide);
  }

  return slides.slice(-2);
}

function recommendationScore(slide: NarrativeSlide) {
  const haystack = `${slide.title} ${slide.body ?? ""} ${(slide.bullets ?? []).join(" ")} ${slide.callout?.text ?? ""}`.toLowerCase();
  let score = 0;
  if (/recommend|action|priority|next step|roadmap|should|opportunit|focus/.test(haystack)) score += 3;
  if (/raccomand|azione|priorit|prossim|opportunit|focus/.test(haystack)) score += 3;
  if ((slide.bullets?.length ?? 0) > 0) score += 1;
  if (slide.callout?.text) score += 1;
  return score;
}

function formatMetric(metric: NarrativeMetric) {
  const parts = [`${metric.label}: ${metric.value}`];
  if (metric.delta) {
    parts.push(`(${metric.delta})`);
  }
  return parts.join(" ");
}

function summarizeBullets(bullets: string[] | undefined, labels: ReturnType<typeof getLabels>) {
  if (!bullets || bullets.length === 0) {
    return "";
  }

  const cleaned = bullets
    .map((bullet) => normalizeSentence(bullet))
    .filter(Boolean)
    .slice(0, 4);

  if (cleaned.length === 0) {
    return "";
  }

  if (cleaned.length === 1) {
    return cleaned[0];
  }

  return `${labels.pointsIntro} ${cleaned.join("; ")}`;
}

function compactParagraphs(values: Array<string | undefined | null | false>) {
  const seen = new Set<string>();
  const paragraphs: string[] = [];

  for (const value of values) {
    const normalized = normalizeParagraph(typeof value === "string" ? value : "");
    if (!normalized || seen.has(normalized.toLowerCase())) {
      continue;
    }
    seen.add(normalized.toLowerCase());
    paragraphs.push(normalized);
  }

  return paragraphs;
}

function normalizeParagraph(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSentence(value: string) {
  const normalized = normalizeParagraph(value).replace(/[.;:,]+$/g, "");
  return normalized;
}

function paragraphBlocks(values: Array<string | undefined | null | false>) {
  return compactParagraphs(values).map((text) => ({
    kind: "paragraph" as const,
    text,
  }));
}

function dedupeBlocks(blocks: ReportBlock[]) {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    const key = block.kind === "paragraph"
      ? `p:${block.text.toLowerCase()}`
      : `t:${JSON.stringify(block.rows).toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function joinHumanList(values: string[], labels: ReturnType<typeof getLabels>) {
  if (values.length === 0) {
    return "";
  }
  if (values.length === 1) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0]} ${labels.andWord} ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, ${labels.andWord} ${values.at(-1)}`;
}

function firstNonEmpty(...values: Array<string | undefined | null>) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
}

/**
 * Try to extract a client/company name from the business context text.
 * Looks for patterns like "for felfel.ch" or "felfel.ch's" or "felfel.ch has".
 */
function extractClientHint(context: string | undefined | null): string | undefined {
  if (!context) return undefined;
  // Match "for <name>" at the start or "X's" possessive pattern
  const forMatch = context.match(/\bfor\s+([A-Za-z0-9][A-Za-z0-9._-]+(?:\.[a-z]{2,})?)[\s,]/i);
  if (forMatch?.[1]) return forMatch[1];
  const possessiveMatch = context.match(/\b([A-Za-z0-9][A-Za-z0-9._-]+(?:\.[a-z]{2,})?)'s\b/i);
  if (possessiveMatch?.[1]) return possessiveMatch[1];
  return undefined;
}

function resolveNarrativeLanguage(input: {
  run: NarrativeRunContext;
  analysis: NarrativeAnalysis;
  manifest: DeckManifest;
}) {
  const hint = input.analysis.language ?? "";
  if (/ital|en/i.test(hint)) {
    return hint;
  }

  const sample = [
    input.run.objective,
    input.run.business_context,
    input.run.audience,
    input.run.thesis,
    input.analysis.executiveSummary,
    input.manifest.slides[0]?.title,
    input.manifest.slides[1]?.title,
  ].filter(Boolean).join(" ");

  return /[àèéìòù]/i.test(sample) || /\b(il|lo|la|gli|mercato|crescita|paniere|raccomandazioni|contesto)\b/i.test(sample)
    ? "Italian"
    : "English";
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getLabels(languageHint?: string) {
  const isItalian = /ital/i.test(languageHint ?? "");
  if (isItalian) {
    return {
      defaultTitle: "Report Basquio",
      preparedFor: "Preparato per",
      generatedOnLabel: "Creato il",
      objectiveLabel: "Obiettivo",
      audienceLabel: "Destinatari",
      clientLabel: "Cliente",
      stakesLabel: "Posta in gioco",
      businessContextLabel: "Contesto di business",
      thesisLabel: "Tesi",
      executiveSummary: "Sintesi esecutiva",
      context: "Domanda di business e contesto",
      findings: "Evidenze chiave",
      findingsIntro:
        "Di seguito sviluppiamo le evidenze principali in modo piu discorsivo, con i numeri raccolti in tabelle compatte quando servono.",
      recommendations: "Azioni consigliate",
      recommendationsIntro:
        "Le priorita finali mantengono la stessa direzione del deck, ma qui sono spiegate in modo piu operativo.",
      evidenceNotes: "Note sulle evidenze",
      keyNumbers: "Numeri chiave",
      implicationLabel: "Implicazione",
      readingLabel: "In pratica",
      whatToDoLabel: "Cosa fare",
      whyItMattersLabel: "Perche conta",
      howToActLabel: "Come muoversi",
      pointsIntro: "In concreto",
      summaryBridgeIntro: "Nel complesso, il lavoro converge su tre messaggi",
      metricTableTitle: "Tabella di sintesi",
      metricColumnLabel: "Indicatore",
      valueColumnLabel: "Valore",
      changeColumnLabel: "Variazione",
      notAvailable: "n.d.",
      metricTableBridge:
        "La tabella sotto raccoglie i numeri da tenere a riferimento, mentre l'interpretazione resta nel testo.",
      andWord: "e",
      unknownValue: "Non specificato",
      methodParagraph:
        "Questo documento espande in forma narrativa lo stesso ragionamento evidence-based del deck. E intenzionalmente text-first, senza grafici, per facilitarne riuso, commento e passaggio in altri workflow AI.",
      wordLanguage: "it-IT",
    };
  }

  return {
    defaultTitle: "Basquio Report",
    preparedFor: "Prepared for",
    generatedOnLabel: "Generated on",
    objectiveLabel: "Objective",
    audienceLabel: "Audience",
    clientLabel: "Client",
    stakesLabel: "Stakes",
    businessContextLabel: "Business context",
    thesisLabel: "Thesis",
    executiveSummary: "Executive Summary",
    context: "Business Question and Context",
    findings: "Detailed Findings",
    findingsIntro:
      "The sections below explain each key finding in plain language, while compact tables keep the core numbers readable.",
    recommendations: "Recommended Actions",
    recommendationsIntro:
      "The final priorities stay aligned with the deck, but this report explains the rationale and execution more clearly.",
    evidenceNotes: "Evidence Notes",
    keyNumbers: "Key numbers",
    implicationLabel: "Implication",
    readingLabel: "What this means",
    whatToDoLabel: "What to do",
    whyItMattersLabel: "Why it matters",
    howToActLabel: "How to act",
    pointsIntro: "Specifically",
    summaryBridgeIntro: "Taken together, the work points to three clear messages",
    metricTableTitle: "Key metrics",
    metricColumnLabel: "Metric",
    valueColumnLabel: "Value",
    changeColumnLabel: "Change",
    notAvailable: "n/a",
    metricTableBridge:
      "The table below keeps the key numbers readable, while the text explains the business meaning.",
    andWord: "and",
    unknownValue: "Unspecified",
    methodParagraph:
      "This document expands the same evidence-backed story as the deck in a text-first format. It intentionally excludes charts so it is easier to share, review, and reuse in downstream AI workflows.",
    wordLanguage: "en-US",
  };
}
