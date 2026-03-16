import type { Message, MessageReaction, PartialMessageReaction, User } from "discord.js";
import { extractFromTranscript } from "./extractor.js";
import { createIssues } from "./linear.js";
import { saveTranscript, upsertLead, saveDecisions } from "./supabase.js";
import { postSessionSummary } from "./discord.js";
import { env, TEXT_BUFFER_FLUSH_MS, TEXT_SILENCE_TIMEOUT_MS } from "./config.js";
import { handleBotMention } from "./searcher.js";
import { embedAndStoreTranscript } from "./transcript-embedder.js";

interface BufferedMessage {
  author: string;
  content: string;
  timestamp: Date;
}

let messageBuffer: BufferedMessage[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let silenceTimer: ReturnType<typeof setTimeout> | null = null;
let bufferStartedAt: Date | null = null;

// Trivial messages to skip
const TRIVIAL_PATTERNS = /^(ok|lol|lmao|haha|nice|👍|👎|❤️|😂|🤣|yes|no|si|va bene|grazie|thanks|thx|ty)$/i;

/**
 * Handle an incoming text message in #general.
 */
export function handleTextMessage(message: Message): void {
  // Skip bot messages and trivial content
  if (message.author.bot) return;
  if (message.content.length < 20 && TRIVIAL_PATTERNS.test(message.content.trim())) return;
  if (message.content.trim().length < 5) return;

  const buffered: BufferedMessage = {
    author: message.member?.displayName ?? message.author.username,
    content: message.content,
    timestamp: new Date(),
  };

  if (!bufferStartedAt) {
    bufferStartedAt = new Date();
  }

  messageBuffer.push(buffered);

  // Reset silence timer
  if (silenceTimer) clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => flushBuffer(), TEXT_SILENCE_TIMEOUT_MS);

  // Start flush timer if not already running
  if (!flushTimer) {
    flushTimer = setTimeout(() => flushBuffer(), TEXT_BUFFER_FLUSH_MS);
  }
}

/**
 * Handle emoji reactions for quick actions.
 * 🐛 → create bug issue
 * 💡 → create feature issue
 * ⚡ → force flush buffer now
 * 🏢 → create/update CRM lead
 */
export async function handleReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User,
): Promise<void> {
  if (user.bot) return;

  const emoji = reaction.emoji.name;
  const message = reaction.message;

  // Force fetch if partial
  if (message.partial) {
    try {
      await message.fetch();
    } catch {
      return;
    }
  }

  const content = message.content ?? "";
  const author = message.member?.displayName ?? message.author?.username ?? "Unknown";

  try {
    switch (emoji) {
      case "⚡": {
        await flushBuffer();
        break;
      }

      case "🐛": {
        await createQuickIssue(content, author, "bug");
        break;
      }

      case "💡": {
        await createQuickIssue(content, author, "feature");
        break;
      }

      case "🏢": {
        await createQuickLead(content, author);
        break;
      }

      case "📚": {
        // Index this message as a knowledge snippet
        await indexMessageAsSnippet(content, author, message as Message);
        break;
      }

      case "🔍": {
        // Search for this message's content
        if (content.length > 3) {
          await handleBotMention(message as Message, content);
        }
        break;
      }
    }
  } catch (err) {
    console.error(`❌ Reaction handler failed for ${emoji}:`, err);
  }
}

/**
 * Create a single issue from a reacted message without running full extraction.
 */
async function createQuickIssue(
  content: string,
  author: string,
  category: "bug" | "feature",
): Promise<void> {
  const extraction = await extractFromTranscript(
    `[${author}]: ${content}`,
    "text",
  );

  // If extraction didn't produce action items, create one manually
  if (extraction.action_items.length === 0) {
    extraction.action_items = [
      {
        title: content.slice(0, 80),
        description: content,
        category,
        assignee: "Marco",
        priority: category === "bug" ? "high" : "medium",
      },
    ];
  }

  const issues = await createIssues(
    extraction.action_items,
    "discord-reaction",
    "text",
  );

  if (issues.length > 0) {
    console.log(
      `⚡ Quick ${category} from reaction: ${issues[0]!.identifier}`,
    );
  }
}

/**
 * Create a CRM lead from a reacted message.
 */
async function createQuickLead(content: string, author: string): Promise<void> {
  const extraction = await extractFromTranscript(
    `[${author}]: ${content}`,
    "text",
  );

  for (const mention of extraction.sales_mentions) {
    await upsertLead(mention, "reaction-trigger");
    console.log(`🏢 Quick CRM lead from reaction: ${mention.company}`);
  }

  // If no sales mentions extracted, try to use the first word as company name
  if (extraction.sales_mentions.length === 0) {
    const firstLine = content.split("\n")[0] ?? content;
    await upsertLead(
      {
        company: firstLine.slice(0, 100),
        context: content,
        status: "mentioned",
        owner: author,
      },
      "reaction-trigger",
    );
    console.log(`🏢 Quick CRM lead from reaction (manual): ${firstLine.slice(0, 50)}`);
  }
}

/**
 * Index a single message as a knowledge snippet via transcript embedding.
 */
async function indexMessageAsSnippet(content: string, author: string, message: Message): Promise<void> {
  try {
    const snippet = `[${author}]: ${content}`;
    const endedAt = new Date();

    // Save as a micro-transcript so it gets embedded
    const transcriptId = await saveTranscript({
      sessionType: "text",
      startedAt: endedAt,
      endedAt,
      participants: [author],
      rawTranscript: snippet,
      extraction: { summary: content.slice(0, 200), decisions: [], action_items: [], sales_mentions: [], key_quotes: [] },
    });

    await embedAndStoreTranscript(transcriptId, snippet);
    await message.react("✅");
    console.log(`📚 Indexed message snippet from ${author}`);
  } catch (err) {
    console.error("Failed to index message snippet:", err);
  }
}

/**
 * Flush the message buffer — run extraction pipeline on accumulated text messages.
 */
async function flushBuffer(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  if (messageBuffer.length === 0) return;

  const messages = [...messageBuffer];
  const startedAt = bufferStartedAt ?? new Date();
  messageBuffer = [];
  bufferStartedAt = null;

  // Build transcript from buffered messages
  const transcript = messages
    .map((m) => `[${m.author}]: ${m.content}`)
    .join("\n");

  const participants = [...new Set(messages.map((m) => m.author))];

  console.log(
    `💬 Processing ${messages.length} text messages from ${participants.join(", ")}`,
  );

  try {
    const extraction = await extractFromTranscript(transcript, "text");
    const endedAt = new Date();

    const transcriptUrl = "text-session"; // No audio URL for text

    // Save transcript first — always
    const transcriptId = await saveTranscript({
      sessionType: "text",
      startedAt,
      endedAt,
      participants,
      rawTranscript: transcript,
      extraction,
    });

    // Embed transcript chunks for knowledge base (fire-and-forget)
    embedAndStoreTranscript(transcriptId, transcript).catch((err) => {
      console.error(`Failed to embed text transcript ${transcriptId}:`, err);
    });

    // Only create issues if extraction found genuinely actionable items
    let issues: Awaited<ReturnType<typeof createIssues>> = [];
    if (extraction.action_items.length > 0) {
      try {
        issues = await createIssues(extraction.action_items, transcriptUrl, "text");
      } catch (err) {
        console.error("⚠️ Issue creation failed (continuing pipeline):", err);
      }
    }

    if (extraction.decisions.length > 0) {
      await saveDecisions(extraction.decisions, transcriptId);
    }

    const crmUpdates: string[] = [];
    if (extraction.sales_mentions.length > 0) {
      for (const mention of extraction.sales_mentions) {
        await upsertLead(mention, transcriptId);
        crmUpdates.push(`${mention.company} — ${mention.status}`);
      }
    }

    const duration = formatDuration(endedAt.getTime() - startedAt.getTime());

    await postSessionSummary({
      sessionType: "text",
      duration,
      participants,
      extraction,
      issues,
      transcriptUrl,
      crmUpdates,
    });

    console.log(
      `✅ Text session processed: ${issues.length} issues, ${extraction.decisions.length} decisions`,
    );
  } catch (err) {
    console.error("❌ Text processing failed:", err);
  }
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
