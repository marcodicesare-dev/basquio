import type { Message, MessageReaction, PartialMessageReaction, User } from "discord.js";
import { extractFromTranscript } from "./extractor.js";
import { createIssues } from "./linear.js";
import { saveTranscript, upsertLead, saveDecisions } from "./supabase.js";
import { postSessionSummary } from "./discord.js";
import { env, TEXT_INACTIVITY_MS, TEXT_MAX_SESSION_MS } from "./config.js";
import { handleBotMention } from "./searcher.js";
import { embedAndStoreTranscript } from "./transcript-embedder.js";

interface BufferedMessage {
  id: string; // Discord message ID for deduplication
  author: string;
  content: string;
  timestamp: Date;
}

let messageBuffer: BufferedMessage[] = [];
let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
let maxSessionTimer: ReturnType<typeof setTimeout> | null = null;

// Track recently processed message IDs to prevent duplicate sessions
const processedMessageIds = new Set<string>();
const MAX_PROCESSED_IDS = 500;

// Ignore messages sent before bot startup to avoid re-processing after deploys
const BOT_STARTED_AT = new Date();

// Trivial messages to skip
const TRIVIAL_PATTERNS = /^(ok|lol|lmao|haha|nice|👍|👎|❤️|😂|🤣|yes|no|si|va bene|grazie|thanks|thx|ty)$/i;

/**
 * Handle an incoming text message in #general.
 */
export function handleTextMessage(message: Message): void {
  // Skip bot messages, webhooks, @mentions (handled by searcher), and trivial content
  if (message.author.bot) return;
  if (message.webhookId) return;
  if (message.mentions.users.size > 0) return;
  if (message.createdAt < BOT_STARTED_AT) return; // Skip pre-startup messages (deploy dedup)
  if (processedMessageIds.has(message.id)) return; // Already processed
  if (message.content.length < 20 && TRIVIAL_PATTERNS.test(message.content.trim())) return;
  if (message.content.trim().length < 5) return;

  const buffered: BufferedMessage = {
    id: message.id,
    author: message.member?.displayName ?? message.author.username,
    content: message.content,
    timestamp: message.createdAt,
  };

  messageBuffer.push(buffered);

  // Reset inactivity timer on every message — session ends only after
  // 5 min of silence, so active conversations stay as one session
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => flushBuffer(), TEXT_INACTIVITY_MS);

  // Start hard-cap timer on first message only (safety net: 1 hour max)
  if (!maxSessionTimer) {
    maxSessionTimer = setTimeout(() => flushBuffer(), TEXT_MAX_SESSION_MS);
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

  // If LLM found nothing actionable, create a minimal issue from the reaction intent
  if (extraction.action_items.length === 0) {
    extraction.action_items = [
      {
        title: content.slice(0, 80),
        description: `Flagged via ${category === "bug" ? "🐛" : "💡"} reaction by ${author}:\n${content}`,
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
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
  if (maxSessionTimer) {
    clearTimeout(maxSessionTimer);
    maxSessionTimer = null;
  }

  if (messageBuffer.length === 0) return;

  const messages = [...messageBuffer];
  messageBuffer = [];

  // Mark all messages as processed to prevent reprocessing after deploys/restarts
  for (const m of messages) {
    processedMessageIds.add(m.id);
    // Keep the set bounded
    if (processedMessageIds.size > MAX_PROCESSED_IDS) {
      const first = processedMessageIds.values().next().value;
      if (first) processedMessageIds.delete(first);
    }
  }

  // Use actual message timestamps for duration, not buffer timer
  const startedAt = messages[0]!.timestamp;
  const endedAt = messages[messages.length - 1]!.timestamp;

  // Build transcript from buffered messages
  const transcript = messages
    .map((m) => `[${m.author}]: ${m.content}`)
    .join("\n");

  const participants = [...new Set(messages.map((m) => m.author))];

  console.log(
    `💬 Processing ${messages.length} text messages from ${participants.join(", ")}`,
  );

  // For thin sessions (1-2 messages from a single person), save transcript
  // for the knowledge base but skip extraction — these rarely contain
  // actionable items and just create noise in Linear.
  const isThinSession = messages.length <= 2 && participants.length === 1;

  try {
    const extraction = await extractFromTranscript(transcript, "text", {
      messageCount: messages.length,
      participantCount: participants.length,
    });

    // Save transcript first — always
    const transcriptId = await saveTranscript({
      sessionType: "text",
      startedAt,
      endedAt,
      participants,
      rawTranscript: transcript,
      extraction,
    });

    // Build a real transcript link (Supabase dashboard)
    const transcriptUrl = `${env.SUPABASE_URL}/rest/v1/transcripts?id=eq.${transcriptId}`;

    // Embed transcript chunks for knowledge base (fire-and-forget)
    embedAndStoreTranscript(transcriptId, transcript).catch((err) => {
      console.error(`Failed to embed text transcript ${transcriptId}:`, err);
    });

    // Skip issue creation for thin sessions — they're mostly noise
    let issues: Awaited<ReturnType<typeof createIssues>> = [];
    if (!isThinSession && extraction.action_items.length > 0) {
      try {
        issues = await createIssues(extraction.action_items, transcriptUrl, "text");
      } catch (err) {
        console.error("⚠️ Issue creation failed (continuing pipeline):", err);
      }
    } else if (isThinSession && extraction.action_items.length > 0) {
      console.log(`📭 Thin session (${messages.length} msgs, 1 author) — skipping ${extraction.action_items.length} issue(s)`);
    }

    if (extraction.decisions.length > 0) {
      await saveDecisions(extraction.decisions, transcriptId);
    }

    const crmUpdates: string[] = [];
    if (!isThinSession && extraction.sales_mentions.length > 0) {
      for (const mention of extraction.sales_mentions) {
        await upsertLead(mention, transcriptId);
        crmUpdates.push(`${mention.company} — ${mention.status}`);
      }
    }

    const duration = formatDuration(endedAt.getTime() - startedAt.getTime());

    // Skip posting summary for thin sessions that had no meaningful extraction
    if (isThinSession && issues.length === 0 && extraction.decisions.length === 0) {
      console.log(`📭 Thin session — saved transcript only, no summary posted`);
      return;
    }

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
