// @ts-expect-error pdf-parse has no type declarations
import pdfParse from "pdf-parse";
import type { ParseResult } from "../kb-types.js";

export async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  const data = await pdfParse(buffer);

  // If text extraction yields almost nothing, the PDF is likely scanned — caller
  // should fall back to Claude Vision via image parser.
  if (data.text.trim().length < 50) {
    return {
      text: "",
      metadata: { pageCount: data.numpages, hasImages: true },
    };
  }

  return {
    text: data.text,
    metadata: {
      pageCount: data.numpages,
      hasImages: false,
    },
  };
}
