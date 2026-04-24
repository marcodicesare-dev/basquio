import mammoth from "mammoth";
import * as ExcelJS from "exceljs";
import JSZip from "jszip";

export type ParseResult = {
  text: string;
  pageCount?: number;
  metadata: Record<string, unknown>;
};

export async function parseDocument(
  buffer: Buffer,
  ext: string,
  contentType?: string,
): Promise<ParseResult> {
  const lower = ext.toLowerCase();

  if (lower === "pdf") {
    return parsePdf(buffer);
  }

  if (lower === "docx") {
    return parseDocx(buffer);
  }

  if (lower === "pptx") {
    return parsePptx(buffer);
  }

  if (lower === "xlsx" || lower === "xls") {
    return parseXlsx(buffer);
  }

  if (lower === "csv") {
    return parseTextLike(buffer);
  }

  if (lower === "md" || lower === "txt" || lower === "json" || lower === "yaml" || lower === "yml") {
    return parseTextLike(buffer);
  }

  if (contentType?.startsWith("text/") || contentType === "application/json") {
    return parseTextLike(buffer);
  }

  return {
    text: "",
    metadata: { skipped: true, reason: `No parser for .${ext}` },
  };
}

async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  type PdfParseV1 = (data: Buffer) => Promise<{ text?: string; numpages?: number }>;
  type PdfParseModule = Partial<{
    default: PdfParseV1 | { PDFParse?: PdfParseV2Class };
    "module.exports": PdfParseV1;
    PDFParse: PdfParseV2Class;
  }>;
  type PdfParseV2Class = new (opts: { data: Uint8Array }) => {
      getText(): Promise<{ text?: string }>;
      destroy(): Promise<void>;
    };

  const pdfModule = (await import("pdf-parse")) as unknown as PdfParseModule;
  const parseV1 =
    typeof pdfModule.default === "function"
      ? pdfModule.default
      : typeof pdfModule["module.exports"] === "function"
        ? pdfModule["module.exports"]
        : null;

  if (parseV1) {
    const result = await parseV1(buffer);
    return {
      text: (result.text ?? "").trim(),
      pageCount: result.numpages,
      metadata: {},
    };
  }

  const PDFParse =
    pdfModule.PDFParse ??
    (typeof pdfModule.default === "object" && pdfModule.default
      ? pdfModule.default.PDFParse
      : undefined);
  if (!PDFParse) {
    throw new Error("pdf-parse runtime did not expose a parser.");
  }

  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const pages = (result as unknown as { pages?: unknown[] }).pages;
    return {
      text: (result.text ?? "").trim(),
      pageCount: Array.isArray(pages) ? pages.length : undefined,
      metadata: {},
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function parsePptx(buffer: Buffer): Promise<ParseResult> {
  const zip = await JSZip.loadAsync(buffer);
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const chartDataByName = new Map<string, string>();
  const chartEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/charts\/chart\d+\.xml$/i.test(name))
    .sort((a, b) => chartNumber(a) - chartNumber(b));

  for (const chartEntry of chartEntries) {
    const chartXml = await zip.files[chartEntry].async("text").catch(() => "");
    const chartText = extractChartDataFromXml(chartXml);
    if (!chartText) continue;
    const chartName = chartEntry.replace(/^ppt\/charts\//, "").replace(/\.xml$/i, "");
    chartDataByName.set(chartName, chartText);
  }

  const slideChartNames = new Map<number, string[]>();
  for (const slideEntry of slideEntries) {
    const relsPath = slideEntry.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
    const rels = zip.files[relsPath]
      ? await zip.files[relsPath].async("text").catch(() => "")
      : "";
    if (!rels) continue;
    const names = Array.from(rels.matchAll(/Target="\.\.\/charts\/(chart\d+)\.xml"/gi))
      .map((match) => match[1])
      .filter(Boolean);
    if (names.length > 0) {
      slideChartNames.set(slideNumber(slideEntry), names);
    }
  }

  const lines: string[] = [];
  for (const slideEntry of slideEntries) {
    const xml = await zip.files[slideEntry].async("text");
    const slideNum = slideNumber(slideEntry);
    const text = extractTextRuns(xml);
    const table = extractTableDataFromSlideXml(xml);
    const charts = (slideChartNames.get(slideNum) ?? [])
      .map((name) => chartDataByName.get(name))
      .filter((value): value is string => Boolean(value));

    const parts = [
      text,
      table ? `[Table data]\n${table}` : "",
      ...charts.map((chart) => `[Chart data]\n${chart}`),
    ].filter((part) => part.trim().length > 0);

    if (parts.length > 0) {
      lines.push(`[Slide ${slideNum}]\n${parts.join("\n")}`);
    }
  }

  return {
    text: lines.join("\n\n").trim(),
    pageCount: slideEntries.length,
    metadata: {
      slideCount: slideEntries.length,
      chartCount: chartEntries.length,
    },
  };
}

async function parseDocx(buffer: Buffer): Promise<ParseResult> {
  const result = await mammoth.extractRawText({ buffer: buffer as unknown as Buffer });
  return {
    text: (result.value ?? "").trim(),
    metadata: {
      messages: result.messages?.length ?? 0,
    },
  };
}

function extractTextRuns(xml: string): string {
  return Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g))
    .map((match) => decodeXml(match[1]).trim())
    .filter(Boolean)
    .join(" ");
}

function extractChartDataFromXml(chartXml: string): string | null {
  const parts: string[] = [];
  const title = chartXml.match(/<c:chart[^>]*>[\s\S]*?<c:title>[\s\S]*?<a:t>([^<]+)<\/a:t>/);
  if (title?.[1]) {
    parts.push(`Title: ${decodeXml(title[1]).trim()}`);
  }

  const labels: string[] = [];
  for (const catBlock of chartXml.match(/<c:cat>[\s\S]*?<\/c:cat>/g) ?? []) {
    for (const value of Array.from(catBlock.matchAll(/<c:v>([\s\S]*?)<\/c:v>/g))) {
      const label = decodeXml(value[1]).trim();
      if (label && !labels.includes(label)) labels.push(label);
    }
  }

  for (const series of chartXml.match(/<c:ser>[\s\S]*?<\/c:ser>/g) ?? []) {
    const name = series.match(/<c:tx>[\s\S]*?<c:v>([\s\S]*?)<\/c:v>/)?.[1];
    const seriesName = name ? decodeXml(name).trim() : "Series";
    const valueBlock =
      series.match(/<c:val>[\s\S]*?<\/c:val>/)?.[0] ??
      series.match(/<c:yVal>[\s\S]*?<\/c:yVal>/)?.[0];
    if (!valueBlock) continue;
    const values = Array.from(valueBlock.matchAll(/<c:v>([\s\S]*?)<\/c:v>/g))
      .map((match) => decodeXml(match[1]).trim())
      .filter(Boolean);
    if (values.length === 0) continue;
    if (labels.length === values.length) {
      parts.push(`${seriesName}: ${labels.map((label, i) => `${label}: ${values[i]}`).join(", ")}`);
    } else {
      parts.push(`${seriesName}: ${values.join(", ")}`);
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

function extractTableDataFromSlideXml(slideXml: string): string | null {
  const tables: string[] = [];
  for (const tableXml of slideXml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/g) ?? []) {
    const rows: string[] = [];
    for (const rowXml of tableXml.match(/<a:tr[^>]*>[\s\S]*?<\/a:tr>/g) ?? []) {
      const cells = Array.from(rowXml.matchAll(/<a:tc[^>]*>([\s\S]*?)<\/a:tc>/g))
        .map((cell) => extractTextRuns(cell[1]))
        .filter((cellText) => cellText.length > 0);
      if (cells.length > 0) {
        rows.push(cells.join(" | "));
      }
    }
    if (rows.length > 0) {
      tables.push(rows.join("\n"));
    }
  }
  return tables.length > 0 ? tables.join("\n\n") : null;
}

function slideNumber(path: string): number {
  return Number(path.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
}

function chartNumber(path: string): number {
  return Number(path.match(/chart(\d+)\.xml/i)?.[1] ?? 0);
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

async function parseXlsx(buffer: Buffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
  const lines: string[] = [];
  let sheetCount = 0;
  wb.eachSheet((sheet) => {
    sheetCount += 1;
    lines.push(`# Sheet: ${sheet.name}`);
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.value;
        if (value == null) return;
        if (typeof value === "object" && "text" in value) {
          cells.push(String((value as { text: string }).text));
        } else if (typeof value === "object" && "richText" in value) {
          const rich = (value as { richText: Array<{ text: string }> }).richText;
          cells.push(rich.map((r) => r.text).join(""));
        } else if (value instanceof Date) {
          cells.push(value.toISOString().slice(0, 10));
        } else {
          cells.push(String(value));
        }
      });
      if (cells.length > 0) {
        lines.push(cells.join("\t"));
      }
    });
    lines.push("");
  });
  return {
    text: lines.join("\n").trim(),
    metadata: { sheetCount },
  };
}

function parseTextLike(buffer: Buffer): ParseResult {
  const text = buffer.toString("utf8").trim();
  return {
    text,
    metadata: {},
  };
}

export function chunkText(text: string, chunkSize = 1200, overlap = 150): string[] {
  if (!text) return [];
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > chunkSize) {
      if (current) chunks.push(current.trim());
      if (para.length > chunkSize) {
        for (let i = 0; i < para.length; i += chunkSize - overlap) {
          chunks.push(para.slice(i, i + chunkSize).trim());
        }
        current = "";
      } else {
        const tail = current.length > overlap ? current.slice(-overlap) : "";
        current = (tail ? tail + "\n\n" : "") + para;
      }
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }

  if (current) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}
