import { parsePdf } from "./pdf.js";
import { parseDocx } from "./docx.js";
import { parsePptx } from "./pptx.js";
import { parseImage } from "./image.js";
import { parseMarkdown } from "./markdown.js";
import type { ParseResult } from "../kb-types.js";

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export async function parseFile(buffer: Buffer, contentType: string, filename: string): Promise<ParseResult> {
  // Normalize content type (strip params like charset)
  const ct = contentType.split(";")[0].trim().toLowerCase();

  if (ct === "application/pdf") {
    const result = await parsePdf(buffer);
    // If PDF text extraction failed (scanned PDF), fall back to image parser
    if (result.text.length < 50) {
      console.log(`📷 PDF "${filename}" appears scanned — falling back to Vision OCR`);
      return parseImage(buffer, "image/png");
    }
    return result;
  }

  if (ct === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return parseDocx(buffer);
  }

  if (ct === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return parsePptx(buffer);
  }

  if (IMAGE_TYPES.has(ct)) {
    return parseImage(buffer, ct);
  }

  if (ct === "text/plain" || ct === "text/markdown" || ct === "text/csv") {
    return parseMarkdown(buffer);
  }

  // Try to infer from file extension
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return parsePdf(buffer);
  if (ext === "docx") return parseDocx(buffer);
  if (ext === "pptx") return parsePptx(buffer);
  if (ext === "md" || ext === "txt" || ext === "csv") return parseMarkdown(buffer);
  if (ext && ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
    return parseImage(buffer, `image/${ext === "jpg" ? "jpeg" : ext}`);
  }

  throw new Error(`Unsupported file type: ${ct} (${filename})`);
}
