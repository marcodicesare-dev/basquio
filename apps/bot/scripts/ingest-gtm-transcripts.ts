/**
 * One-off script that ingests the May 1 GTM + product transcripts (the export
 * Marco dropped in /tmp from Notion) into the bot's session pipeline. The
 * transcripts get extracted by Claude, persisted in Supabase, embedded for
 * hybrid search, and a session summary is posted to #basquio-ai exactly the
 * way a live recorded session would be.
 *
 * Marco asked: "see these transcripts into the sessions" — meaning ingest
 * them through the bot's regular pipeline so they're searchable and
 * summarised the canonical way.
 *
 * Run from repo root with the bot's env injected (Railway CLI):
 *   railway run --service basquio-worker npx tsx apps/bot/scripts/ingest-gtm-transcripts.ts
 *
 * Flags:
 *   --file=path/to/transcripts.md      input file (default: /tmp gtm export)
 *   --participants=marco,fra,ross,...  comma-list (default: full team)
 *   --dry-run                          extract + print, no DB writes, no Discord post
 *   --skip-issues                      run pipeline but do not create Linear issues
 *
 * Idempotent? No — running twice creates duplicate transcripts + duplicate
 * Discord summaries (and duplicate Linear issues unless --skip-issues).
 */

import dotenv from "dotenv";
dotenv.config({ override: true });

import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { env } from "../src/config.js";
import { extractFromTranscript } from "../src/extractor.js";
import { saveTranscript, upsertLead, saveDecisions } from "../src/supabase.js";
import { embedAndStoreTranscript } from "../src/transcript-embedder.js";
import { createIssues } from "../src/linear.js";
import { initChannels, postSessionSummary } from "../src/discord.js";

const DEFAULT_FILE =
  "/tmp/gtm-misc-extract/Private & Shared/misc + gtm 3530eed73812807ea6d0e538f51cf497.md";

const DEFAULT_PARTICIPANTS = ["marco", "francesco", "rossella", "alessandro", "giulia", "veronica"];

function parseArgs() {
  const argv = process.argv.slice(2);
  const fileArg = argv.find((a) => a.startsWith("--file="));
  const participantsArg = argv.find((a) => a.startsWith("--participants="));
  return {
    file: fileArg ? resolve(process.cwd(), fileArg.slice("--file=".length)) : DEFAULT_FILE,
    participants: participantsArg
      ? participantsArg.slice("--participants=".length).split(",").map((s) => s.trim())
      : DEFAULT_PARTICIPANTS,
    dryRun: argv.includes("--dry-run"),
    skipIssues: argv.includes("--skip-issues"),
  };
}

/**
 * The Notion export is one big markdown file with two back-to-back sessions
 * separated by `Summary` and `Notes` and `Transcript` sections. We strip the
 * pre-baked Notion summaries and keep only the transcript prose, because the
 * point of running this through the pipeline is to let Claude do its own
 * extraction. We DO keep the H1 line at the top so the session has a name.
 */
function stripNotionScaffolding(md: string): string {
  // Remove repeated "Summary" + "Notes" + "Transcript" Notion section headers
  // but keep the actual prose between/after them.
  return md
    .replace(/\r\n/g, "\n")
    .replace(/^# .*\n/, "") // drop the H1 — we use a separate session label
    .trim();
}

async function main() {
  const args = parseArgs();
  console.log(`📄 Reading ${args.file}`);
  const raw = await readFile(args.file, "utf-8");
  console.log(`   ${raw.length} chars, ${raw.split("\n").length} lines`);

  const transcript = stripNotionScaffolding(raw);
  console.log(`✂️  Stripped to ${transcript.length} chars\n`);

  // The Notion file holds two consecutive sessions from May 1 evening. We treat
  // them as ONE bundled session for ingestion purposes (the action-items doc
  // already separates the two for human consumption).
  const sessionStart = new Date("2026-05-01T17:00:00+02:00");
  const sessionEnd = new Date("2026-05-01T20:00:00+02:00");

  console.log("🧠 Extracting with Claude…");
  const extraction = await extractFromTranscript(transcript, "text", {
    messageCount: transcript.split("\n").length,
    participantCount: args.participants.length,
  });
  console.log(`   summary: ${extraction.summary.length} chars`);
  console.log(`   decisions: ${extraction.decisions.length}`);
  console.log(`   action_items: ${extraction.action_items.length}`);
  console.log(`   key_quotes: ${extraction.key_quotes.length}`);
  console.log(`   sales_mentions: ${extraction.sales_mentions.length}\n`);

  if (args.dryRun) {
    console.log("--- DRY RUN — extraction preview ---\n");
    console.log("SUMMARY:\n" + extraction.summary + "\n");
    console.log("DECISIONS:");
    for (const d of extraction.decisions) console.log(`• ${d.decision}`);
    console.log("\nACTION ITEMS:");
    for (const a of extraction.action_items) {
      console.log(`• [${a.assignee ?? "unassigned"}] ${a.title}`);
    }
    console.log("\nKEY QUOTES:");
    for (const q of extraction.key_quotes) console.log(`> ${q}`);
    console.log("\n(Dry run — nothing written, nothing posted.)");
    return;
  }

  // Save transcript
  console.log("💾 Saving transcript…");
  const transcriptId = await saveTranscript({
    sessionType: "text",
    startedAt: sessionStart,
    endedAt: sessionEnd,
    participants: args.participants,
    rawTranscript: transcript,
    extraction,
    metadata: {
      source: "manual_ingest",
      origin: "notion_export_gtm_misc_2026_05_01",
      ingest_script: "apps/bot/scripts/ingest-gtm-transcripts.ts",
    },
  });
  console.log(`   ✅ transcript ${transcriptId}`);

  const transcriptUrl = `${env.SUPABASE_URL}/rest/v1/transcripts?id=eq.${transcriptId}`;

  // Embed for hybrid search (fire and forget)
  embedAndStoreTranscript(transcriptId, transcript).catch((err) => {
    console.error("⚠️ embed failed (continuing):", err);
  });
  console.log(`   📚 embedding queued`);

  // Decisions
  if (extraction.decisions.length > 0) {
    await saveDecisions(extraction.decisions, transcriptId);
    console.log(`   🟦 ${extraction.decisions.length} decisions saved`);
  }

  // Linear issues
  let issues: Awaited<ReturnType<typeof createIssues>> = [];
  if (!args.skipIssues && extraction.action_items.length > 0) {
    try {
      issues = await createIssues(extraction.action_items, transcriptUrl, "text");
      console.log(`   📋 ${issues.length} Linear issues created`);
    } catch (err) {
      console.error("⚠️ Linear issue creation failed (continuing):", err);
    }
  } else if (args.skipIssues) {
    console.log(`   ⏭  Skipping Linear issues (--skip-issues)`);
  }

  // CRM mentions
  const crmUpdates: string[] = [];
  if (extraction.sales_mentions.length > 0) {
    for (const mention of extraction.sales_mentions) {
      try {
        await upsertLead(mention, transcriptId);
        crmUpdates.push(`${mention.company} — ${mention.status}`);
      } catch (err) {
        console.error(`⚠️ Lead upsert failed for ${mention.company}:`, err);
      }
    }
    console.log(`   🔄 ${crmUpdates.length} CRM updates`);
  }

  // Discord post
  console.log("\n🔌 Logging into Discord…");
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await new Promise<void>((resolveReady, rejectReady) => {
    client.once("ready", () => resolveReady());
    client.once("error", rejectReady);
    client.login(env.DISCORD_BOT_TOKEN).catch(rejectReady);
  });
  console.log(`   ✅ Logged in as ${client.user?.tag}`);

  await initChannels(client);

  const duration = "3h";
  const messageId = await postSessionSummary({
    sessionType: "text",
    duration,
    participants: args.participants,
    extraction,
    issues,
    transcriptUrl,
    crmUpdates,
    alertPrefix:
      "📥 **Manual ingest — May 1 GTM + product call transcripts** (Notion export, two sessions bundled)",
  });

  console.log(`   📨 Posted to #basquio-ai (msg ${messageId ?? "?"})`);

  await client.destroy();
  console.log("\n🏁 Done.");
}

main().catch((err) => {
  console.error("❌ Fatal:", err);
  process.exit(1);
});
