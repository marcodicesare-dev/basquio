import type { ParseResult } from "../kb-types.js";

export async function parseMarkdown(buffer: Buffer): Promise<ParseResult> {
  return {
    text: buffer.toString("utf-8"),
    metadata: { hasImages: false },
  };
}
