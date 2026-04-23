import mammoth from "mammoth";
import * as ExcelJS from "exceljs";

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
  // pdf-parse v2 exposes a `PDFParse` class. Root node_modules carries
  // @types/pdf-parse (v1 types) which shadow the v2 built-in types, so
  // cast the dynamic import to the v2 runtime shape. When the canary
  // tsc gate stabilises, drop @types/pdf-parse from root and remove
  // this cast.
  type PdfParseModule = {
    PDFParse: new (opts: { data: Uint8Array }) => {
      getText(): Promise<{ text?: string }>;
      destroy(): Promise<void>;
    };
  };
  const { PDFParse } = (await import("pdf-parse")) as unknown as PdfParseModule;
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

async function parseDocx(buffer: Buffer): Promise<ParseResult> {
  const result = await mammoth.extractRawText({ buffer: buffer as unknown as Buffer });
  return {
    text: (result.value ?? "").trim(),
    metadata: {
      messages: result.messages?.length ?? 0,
    },
  };
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
