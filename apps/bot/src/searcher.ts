import { EmbedBuilder, type Message, type TextChannel } from "discord.js";
import Anthropic from "@anthropic-ai/sdk";
import { embedQuery } from "./embedder.js";
import { hybridSearch, getDocumentMeta, getTranscriptMeta } from "./supabase.js";
import { env } from "./config.js";
import type { SearchResult, Source } from "./kb-types.js";

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// Rate limit: 1 query per user per 5 seconds
const lastQueryTime = new Map<string, number>();
const RATE_LIMIT_MS = 5000;

/**
 * Handle an @mention search query from any channel.
 */
export async function handleBotMention(message: Message, query: string): Promise<void> {
  // Rate limit
  const userId = message.author.id;
  const now = Date.now();
  const lastTime = lastQueryTime.get(userId) ?? 0;
  if (now - lastTime < RATE_LIMIT_MS) {
    await message.reply("Slow down — one question every 5 seconds.");
    return;
  }
  lastQueryTime.set(userId, now);

  try {
    await message.react("🔍");

    const result = await search(query);
    const embed = formatSearchEmbed(query, result);
    await message.reply({ embeds: [embed] });
  } catch (err) {
    console.error("Search failed:", err);
    await message.reply("Search failed — try again in a moment.");
  }
}

/**
 * Run hybrid search + Claude synthesis.
 */
export async function search(query: string): Promise<SearchResult> {
  // 1. Embed query
  const queryEmbedding = await embedQuery(query);

  // 2. Hybrid search
  const chunks = await hybridSearch(query, queryEmbedding, 10);

  if (chunks.length === 0) {
    return {
      answer: "I couldn't find anything relevant in the knowledge base or past conversations.",
      sources: [],
      confidence: "low",
    };
  }

  // 3. Enrich sources
  const sources: Source[] = [];
  const contextParts: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let sourceName = "Unknown";
    let storageUrl: string | undefined;
    let page: number | undefined;

    if (chunk.source_type === "document") {
      const doc = await getDocumentMeta(chunk.source_id);
      if (doc) {
        sourceName = doc.filename;
        storageUrl = doc.storage_path;
        page = (chunk.metadata as Record<string, unknown>).page_number as number | undefined;
      }
    } else {
      const transcript = await getTranscriptMeta(chunk.source_id);
      if (transcript) {
        const date = new Date(transcript.started_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        sourceName = `Voice session — ${date} (${transcript.participants.join(", ")})`;
      }
    }

    sources.push({
      type: chunk.source_type as "document" | "transcript",
      name: sourceName,
      snippet: chunk.content.slice(0, 200),
      page,
      storageUrl,
      metadata: chunk.metadata,
    });

    const typeLabel = chunk.source_type === "document" ? "uploaded doc" : "voice/text transcript";
    contextParts.push(`[${i + 1}] (${typeLabel}: ${sourceName}) ${chunk.content}`);
  }

  // 4. Synthesize with Claude
  const synthesis = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `You are Basquio's knowledge assistant. Answer the question using ONLY the provided context chunks. Cite sources by [number]. If the context doesn't contain enough info, say so — never make things up. Keep answers concise (2-5 sentences) unless the question demands detail.

Important:
- Each source is labeled as "uploaded doc" or "voice/text transcript". Treat them as distinct — an uploaded screenshot about a person is different from a voice session where a similarly-named team member participated.
- Do NOT conflate people who share a name. A document mentioning "Francesco Lama" is not the same person as a team member called "Francesco" in a voice session, unless the content explicitly links them.
- Prioritize uploaded docs when the question is about specific names, leads, or external contacts.`,
    messages: [{
      role: "user",
      content: `Question: ${query}\n\nContext:\n${contextParts.join("\n\n")}`,
    }],
  });

  const answer = synthesis.content[0].type === "text"
    ? synthesis.content[0].text
    : "Could not generate an answer.";

  // 5. Confidence scoring
  // RRF scores with k=50: single-signal rank 1 = 1/51 ≈ 0.0196, dual rank 1 ≈ 0.0392
  // With Italian queries, FTS (English config) often misses, leaving semantic only.
  // Use top score + spread: if top 3 are close, results are noisy → lower confidence.
  const topScore = chunks[0]?.score ?? 0;
  const thirdScore = chunks[2]?.score ?? 0;
  const spread = topScore - thirdScore; // Higher spread = clearer signal
  let confidence: "high" | "medium" | "low";
  if (topScore > 0.030 || (topScore > 0.018 && spread > 0.003)) confidence = "high";
  else if (topScore > 0.014 || (topScore > 0.010 && spread > 0.002)) confidence = "medium";
  else confidence = "low";

  return { answer, sources, confidence };
}

/**
 * Format a SearchResult as a Discord embed.
 */
export function formatSearchEmbed(query: string, result: SearchResult): EmbedBuilder {
  const confidenceEmoji = result.confidence === "high" ? "🟢" : result.confidence === "medium" ? "🟡" : "🔴";
  const color = result.confidence === "high" ? 0x22c55e : result.confidence === "medium" ? 0xeab308 : 0xef4444;

  const embed = new EmbedBuilder()
    .setTitle(`🔍 ${query.replace(/<@[!&]?\d+>/g, "").trim().slice(0, 200)}`)
    .setDescription(result.answer)
    .setColor(color);

  // Show only sources that Claude actually cited in the answer
  const citedIndices = new Set<number>();
  const citationPattern = /\[(\d+)\]/g;
  let match;
  while ((match = citationPattern.exec(result.answer)) !== null) {
    citedIndices.add(parseInt(match[1], 10) - 1); // convert 1-indexed to 0-indexed
  }

  // If Claude cited specific sources, show only those; otherwise fall back to top 5
  const displaySources = citedIndices.size > 0
    ? result.sources.filter((_, i) => citedIndices.has(i))
    : result.sources.slice(0, 5);

  if (displaySources.length > 0) {
    const sourceLines = displaySources.map((s) => {
      const icon = s.type === "document" ? "📄" : "🎙️";
      const pageStr = s.page ? ` (p. ${s.page})` : "";
      return `${icon} ${s.name}${pageStr}`;
    });
    embed.addFields({ name: "Sources", value: sourceLines.join("\n") });
  }

  const docCount = result.sources.filter((s) => s.type === "document").length;
  const transcriptCount = result.sources.filter((s) => s.type === "transcript").length;
  embed.setFooter({
    text: `${confidenceEmoji} ${result.confidence.charAt(0).toUpperCase() + result.confidence.slice(1)} confidence | Searched ${docCount} docs + ${transcriptCount} transcripts`,
  });

  return embed;
}

/**
 * Post a search result to #basquio-ai (used by voice Q&A).
 */
export async function postSearchToChannel(
  channel: TextChannel,
  query: string,
  askedBy: string,
): Promise<void> {
  const result = await search(query);
  const embed = formatSearchEmbed(query, result);
  embed.setAuthor({ name: `Asked by ${askedBy} in voice` });
  await channel.send({ embeds: [embed] });
}
