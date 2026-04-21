import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * Haiku-backed reranker (Anthropic Contextual Retrieval, §reranker).
 *
 * Given a ranked candidate pool from the hybrid RPC, ask Haiku to score each
 * chunk's relevance to the user query on a 0-10 scale and return the top N
 * in the new order. Anthropic's published numbers: +18% top-20 recall on top
 * of the hybrid-retrieval pipeline.
 *
 * Behavior:
 *   - No-op (returns the input unchanged) unless BASQUIO_WORKSPACE_RERANKER=haiku
 *     AND ANTHROPIC_API_KEY is set. Feature-flagged so we never silently add
 *     LLM latency + spend to every chat turn.
 *   - Rank-1 chunks (conversation-attachment and inline-excerpt) are ALWAYS
 *     kept at the top. The reranker only reorders the workspace-lane tail.
 *   - If the model call fails or parsing misses, we fall back to the original
 *     order. Never throw.
 */

type RankableChunk<T> = {
  key: string;
  text: string;
  payload: T;
  pinned?: boolean;
};

const RERANKER_MODEL = process.env.BASQUIO_RERANKER_MODEL ?? "claude-haiku-4-5";
const MAX_POOL_SIZE = 40;

export function isRerankerEnabled(): boolean {
  const flag = (process.env.BASQUIO_WORKSPACE_RERANKER ?? "off").toLowerCase();
  return flag === "haiku" && Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function rerankChunks<T>(input: {
  query: string;
  chunks: Array<RankableChunk<T>>;
  topN: number;
}): Promise<Array<RankableChunk<T>>> {
  if (!isRerankerEnabled() || input.chunks.length <= 1) {
    return input.chunks.slice(0, input.topN);
  }

  const pinned = input.chunks.filter((c) => c.pinned);
  const candidates = input.chunks.filter((c) => !c.pinned).slice(0, MAX_POOL_SIZE);
  if (candidates.length === 0) {
    return pinned.slice(0, input.topN);
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const numbered = candidates
      .map(
        (c, i) =>
          `[${i}] ${c.text.slice(0, 900).replace(/\s+/g, " ").trim()}`,
      )
      .join("\n\n");
    const response = await client.messages.create({
      model: RERANKER_MODEL,
      max_tokens: 320,
      system:
        "You rerank retrieved chunks by relevance to the user's question. You will see a list of chunks prefixed with [0]..[N]. Output JSON only: an array of objects like {\"i\": 3, \"s\": 8} where i is the chunk index and s is a 0-10 integer score. Include every chunk, highest score first. Do NOT output any commentary.",
      messages: [
        {
          role: "user",
          content: `Question:\n${input.query.slice(0, 1200)}\n\nChunks:\n${numbered}\n\nReturn the JSON array now.`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return [...pinned, ...candidates].slice(0, input.topN);
    }

    const parsed = extractJsonArray(textBlock.text);
    if (!parsed) {
      return [...pinned, ...candidates].slice(0, input.topN);
    }

    const validScored: Array<{ index: number; score: number }> = [];
    const sawIndex = new Set<number>();
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const i = Number((entry as { i?: unknown }).i);
      const s = Number((entry as { s?: unknown }).s);
      if (!Number.isFinite(i) || !Number.isFinite(s)) continue;
      const index = Math.trunc(i);
      if (index < 0 || index >= candidates.length) continue;
      if (sawIndex.has(index)) continue; // Dedup model duplicates up front.
      sawIndex.add(index);
      validScored.push({ index, score: Math.max(0, Math.min(10, s)) });
    }

    if (validScored.length === 0) {
      return [...pinned, ...candidates].slice(0, input.topN);
    }

    const ordered: Array<RankableChunk<T>> = [];
    validScored
      .sort((a, b) => b.score - a.score)
      .forEach(({ index }) => {
        ordered.push(candidates[index]);
      });
    // Append any candidates the model skipped to preserve coverage. `sawIndex`
    // already captures what made it into `ordered`, so this loop never adds
    // duplicates.
    for (let i = 0; i < candidates.length; i += 1) {
      if (!sawIndex.has(i)) ordered.push(candidates[i]);
    }

    return [...pinned, ...ordered].slice(0, input.topN);
  } catch (err) {
    console.error("[reranker] failed", err);
    return [...pinned, ...candidates].slice(0, input.topN);
  }
}

function extractJsonArray(raw: string): unknown[] | null {
  // Try direct parse, then fall back to extracting the first [...] bracket pair.
  try {
    const direct = JSON.parse(raw);
    if (Array.isArray(direct)) return direct;
  } catch {
    // fall through
  }
  const match = raw.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
