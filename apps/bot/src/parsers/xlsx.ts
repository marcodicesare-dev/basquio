import { parseOfficeAsync } from "officeparser";
import type { ParseResult } from "../kb-types.js";

export async function parseXlsx(buffer: Buffer): Promise<ParseResult> {
  const text = await parseOfficeAsync(buffer);
  return {
    text,
    metadata: { hasImages: false },
  };
}
