import {
  Client,
  TextChannel,
} from "discord.js";
import type { ExtractionResult } from "@basquio/types";
import type { CreatedIssue } from "./linear.js";
import { env } from "./config.js";
import { getWeeklyDigest } from "./supabase.js";

let botChannel: TextChannel | null = null;
let generalChannel: TextChannel | null = null;

let discordClient: Client | null = null;

/**
 * Cache the target channels on startup.
 * Falls back to fetching if not in cache yet.
 */
export async function initChannels(client: Client): Promise<void> {
  discordClient = client;

  const bot = client.channels.cache.get(env.DISCORD_BOT_CHANNEL_ID)
    ?? await client.channels.fetch(env.DISCORD_BOT_CHANNEL_ID).catch(() => null);
  if (bot instanceof TextChannel) botChannel = bot;

  const general = client.channels.cache.get(env.DISCORD_GENERAL_CHANNEL_ID)
    ?? await client.channels.fetch(env.DISCORD_GENERAL_CHANNEL_ID).catch(() => null);
  if (general instanceof TextChannel) generalChannel = general;

  if (!botChannel) console.error("⚠️ Could not find #basquio-ai channel");
  if (!generalChannel) console.error("⚠️ Could not find #general channel");
}

export function getBotChannel(): TextChannel | null {
  return botChannel;
}

export function getGeneralChannel(): TextChannel | null {
  return generalChannel;
}

/**
 * Post a session summary to #basquio-ai after processing.
 */
export async function postSessionSummary(opts: {
  sessionType: "voice" | "text";
  duration: string;
  participants: string[];
  extraction: ExtractionResult;
  issues: CreatedIssue[];
  transcriptUrl: string;
  crmUpdates: string[];
}): Promise<string | null> {
  if (!botChannel) {
    console.error("Bot channel not initialized");
    return null;
  }

  const lines: string[] = [];

  // Header
  const icon = opts.sessionType === "voice" ? "🎙️" : "💬";
  lines.push(
    `${icon} **SESSION ENDED** — ${opts.duration} | ${opts.participants.join(", ")}`,
  );
  lines.push("");

  // Summary
  lines.push("**SUMMARY**");
  lines.push(opts.extraction.summary);
  lines.push("");

  // Decisions
  if (opts.extraction.decisions.length > 0) {
    lines.push("**DECISIONS**");
    for (const d of opts.extraction.decisions) {
      lines.push(`• ${d.decision}`);
    }
    lines.push("");
  }

  // Issues
  if (opts.issues.length > 0) {
    lines.push("**LINEAR ISSUES CREATED**");
    for (const issue of opts.issues) {
      const labels = issue.labels.map((l) => `\`${l}\``).join(" ");
      lines.push(
        `• **${issue.identifier}**: ${issue.title} ${labels} → assigned: ${issue.assignee}`,
      );
    }
    lines.push("");
  }

  // CRM
  if (opts.crmUpdates.length > 0) {
    lines.push("**CRM**");
    for (const update of opts.crmUpdates) {
      lines.push(`• ${update}`);
    }
    lines.push("");
  }

  // Key quotes
  if (opts.extraction.key_quotes.length > 0) {
    lines.push("**KEY QUOTES**");
    for (const q of opts.extraction.key_quotes) {
      lines.push(`> "${q}"`);
    }
    lines.push("");
  }

  // Transcript link
  lines.push(`Full transcript → ${opts.transcriptUrl}`);

  const content = lines.join("\n");

  // Discord has a 2000 char limit — split if needed
  if (content.length <= 2000) {
    const msg = await botChannel.send(content);
    return msg.id;
  }

  // Split into chunks
  const chunks = splitMessage(content, 2000);
  let firstMsgId: string | null = null;
  for (const chunk of chunks) {
    const msg = await botChannel.send(chunk);
    if (!firstMsgId) firstMsgId = msg.id;
  }
  return firstMsgId;
}

/**
 * Post weekly digest to #general (Monday 9am CET).
 */
export async function postWeeklyDigest(): Promise<void> {
  try {
    if (!generalChannel) {
      console.error("General channel not initialized");
      return;
    }

    const digest = await getWeeklyDigest();

    const lines = [
      "📊 **WEEKLY DIGEST**",
      "",
      `**Sessions:** ${digest.sessionCount} (${digest.totalMinutes} min total)`,
      `**Issues Created:** ${digest.issueCount}`,
      `**Decisions Made:** ${digest.decisionCount}`,
      `**New Leads:** ${digest.leadCount}`,
    ];

    if (digest.topQuotes.length > 0) {
      lines.push("", "**Top Quotes**");
      for (const q of digest.topQuotes) {
        lines.push(`> "${q}"`);
      }
    }

    await generalChannel.send(lines.join("\n"));
    console.log("📊 Weekly digest posted");
  } catch (err) {
    console.error("❌ Weekly digest failed:", err);
  }
}

/**
 * Post a warning when a non-team member joins the voice channel.
 */
export async function postRecordingWarning(username: string): Promise<void> {
  if (!botChannel) return;
  await botChannel.send(
    `⚠️ **${username}** joined The Office. This channel is recorded, transcribed, and processed by AI.`,
  );
}

function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    // Find last newline before limit
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
