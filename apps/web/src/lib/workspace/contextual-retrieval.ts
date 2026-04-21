import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * Contextual Retrieval helpers (Anthropic Sept 2024 pattern).
 *
 * The idea: before embedding a chunk, ask a small/fast model to produce a
 * 50-100 token note that situates the chunk inside its parent document. The
 * embedding input becomes `{contextual_summary}\n\n{chunk}` so semantic
 * search has the surrounding story baked in, and BM25 sees the summary too.
 * Anthropic's published evaluation: 35% top-20 recall lift from this alone,
 * 49% with BM25, 67% with a reranker on top.
 *
 * Cost: about $1.02 / million document tokens one-time, assuming Haiku and
 * prompt caching of the full document text. We batch cheaply: one Haiku call
 * per chunk, but reusing the cached doc prefix is what keeps the bill low.
 *
 * The production expectation is best-effort: if the model call fails or the
 * env var is unset, the caller keeps the plain chunk text. Never block
 * ingestion on contextual summary generation.
 */

const CONTEXTUAL_MODEL = process.env.BASQUIO_CONTEXTUAL_MODEL ?? "claude-haiku-4-5";
const MAX_SUMMARY_TOKENS = 180;

/**
 * Feature flag. When disabled (default), returns null for every chunk and
 * callers fall back to plain-text indexing. Flip BASQUIO_CONTEXTUAL_RETRIEVAL=on
 * to enable.
 */
export function isContextualRetrievalEnabled(): boolean {
  const flag = process.env.BASQUIO_CONTEXTUAL_RETRIEVAL ?? "off";
  return flag.toLowerCase() === "on" && Boolean(process.env.ANTHROPIC_API_KEY);
}

type ContextualInput = {
  documentTitle: string;
  documentText: string;
  chunk: string;
};

/**
 * Generate a contextual summary for a single chunk. Returns the summary text
 * on success, null on any failure. Never throws.
 */
export async function generateContextualSummary(
  input: ContextualInput,
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const documentText = truncateDocument(input.documentText);
  const chunk = input.chunk.trim();
  if (chunk.length === 0) return null;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: CONTEXTUAL_MODEL,
      max_tokens: MAX_SUMMARY_TOKENS,
      system:
        "You situate a chunk inside its parent document for retrieval. Output one short paragraph (50-100 words) that captures: what section of the document the chunk is from, what it is about, and any absolute anchors (brand names, SKUs, time windows, metric names) that would help a search system match a user query. No bullets. No preamble. No meta-commentary. Just the paragraph.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `<document title="${escapeAttr(input.documentTitle)}">\n${documentText}\n</document>`,
              cache_control: { type: "ephemeral" },
            },
            {
              type: "text",
              text: `Here is the chunk to contextualize:\n\n<chunk>\n${chunk}\n</chunk>\n\nReturn ONLY the contextual paragraph.`,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    const summary = textBlock.text.trim();
    if (!summary) return null;
    // Guard against runaway output.
    return summary.length > 1200 ? summary.slice(0, 1200) : summary;
  } catch (err) {
    console.error("[contextual-retrieval] summary generation failed", err);
    return null;
  }
}

/**
 * Cap the document prefix sent into each Haiku call so we never blow the
 * window. 100 k chars (~25 k tokens) keeps the cached prefix tight while still
 * giving Haiku enough surrounding context to position the chunk.
 */
function truncateDocument(text: string): string {
  const MAX = 100_000;
  if (text.length <= MAX) return text;
  return `${text.slice(0, MAX)}\n\n[…document truncated at ${MAX} chars for contextual summary…]`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Compose the text we actually embed + index. The summary is prepended so
 * semantic search picks up the surrounding document context and BM25 sees
 * the anchor terms.
 */
export function composeContextualIndexText(
  summary: string | null,
  rawChunk: string,
): string {
  if (!summary) return rawChunk;
  return `${summary}\n\n${rawChunk}`;
}
