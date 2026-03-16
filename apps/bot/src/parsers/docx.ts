import mammoth from "mammoth";
import type { ParseResult } from "../kb-types.js";

export async function parseDocx(buffer: Buffer): Promise<ParseResult> {
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: result.value,
    metadata: { hasImages: false },
  };
}
