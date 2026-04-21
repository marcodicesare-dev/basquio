import "server-only";

import { parseDocument } from "@/lib/workspace/parsing";

/**
 * Maximum size of the inline excerpt stored on knowledge_documents.inline_excerpt.
 * Chosen to fit comfortably inside the retrieval prompt slot without dominating
 * the context window: about 12-16 k tokens worth of text per doc, which is enough
 * for a CSV schema + first ~200 rows, a PDF's first few pages, or a whole short
 * memo. Larger files will be truncated here and rely on Lane B chunking for the
 * rest.
 */
const MAX_INLINE_EXCERPT_CHARS = 48_000;

/**
 * Extract a best-effort text summary of the uploaded file during the synchronous
 * upload request. This lets the chat's rank-1 retrieval surface real content
 * from the file the user just dropped, before Lane B ingestion has finished
 * producing chunks + embeddings.
 *
 * Return null if the file type has no text projection (images, audio) or if the
 * parser gave back nothing usable. Callers MUST treat the result as advisory —
 * never block the upload flow on this.
 */
export async function extractInlineExcerpt(
  buffer: Buffer,
  ext: string,
  contentType?: string,
): Promise<string | null> {
  if (!isTextyExtension(ext, contentType)) {
    return null;
  }

  const parsed = await parseDocument(buffer, ext, contentType);
  const text = (parsed?.text ?? "").trim();
  if (!text) {
    return null;
  }

  if (text.length <= MAX_INLINE_EXCERPT_CHARS) {
    return text;
  }

  // Truncate on a paragraph boundary when possible so the tail isn't mid-sentence.
  const head = text.slice(0, MAX_INLINE_EXCERPT_CHARS);
  const lastBreak = head.lastIndexOf("\n\n");
  const boundary = lastBreak > MAX_INLINE_EXCERPT_CHARS * 0.6 ? lastBreak : MAX_INLINE_EXCERPT_CHARS;
  return `${head.slice(0, boundary).trimEnd()}\n\n[…truncated at ${MAX_INLINE_EXCERPT_CHARS} chars — full content indexed in background…]`;
}

function isTextyExtension(ext: string, contentType?: string): boolean {
  const lower = (ext ?? "").toLowerCase();
  const TEXTY = new Set([
    "pdf",
    "docx",
    "xlsx",
    "xls",
    "csv",
    "md",
    "txt",
    "json",
    "yaml",
    "yml",
  ]);
  if (TEXTY.has(lower)) return true;
  if (!contentType) return false;
  if (contentType.startsWith("text/")) return true;
  if (contentType === "application/json") return true;
  return false;
}
