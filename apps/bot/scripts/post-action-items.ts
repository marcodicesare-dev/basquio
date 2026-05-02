/**
 * One-off script that posts a markdown doc into #basquio-ai using the bot's
 * Discord client.
 *
 * Marco asked: "post manually the may-2026-gtm-transcripts-action-items.md
 * into discord the usual basquio-ai channel using the existing stack that
 * does everything."
 *
 * The doc is split into sections by H2 (## …), each section is chunked at
 * 1900 chars to stay under Discord's 2000-char per-message ceiling, and each
 * chunk is posted sequentially with a 500ms gap to avoid rate-limit hiccups.
 *
 * Run from repo root with the bot's env injected (Railway CLI):
 *   railway run --service basquio-worker npx tsx apps/bot/scripts/post-action-items.ts
 *
 * Override the input file with --file=path/to/doc.md (default is the
 * action-items doc landed in Path V).
 *
 * Idempotent? No. Running it twice posts twice. Run once.
 */

import dotenv from "dotenv";
dotenv.config({ override: true });

import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { env } from "../src/config.js";

const DEFAULT_FILE = resolve(
  process.cwd(),
  "memory/may-2026-gtm-transcripts-action-items.md",
);

const MAX_CHUNK = 1900; // Discord cap is 2000, leave 100 char headroom for chunk markers

function parseArgs(): { file: string } {
  const argv = process.argv.slice(2);
  const fileArg = argv.find((a) => a.startsWith("--file="));
  return {
    file: fileArg ? resolve(process.cwd(), fileArg.slice("--file=".length)) : DEFAULT_FILE,
  };
}

/**
 * Split a markdown doc by H2 headers. Each section keeps its own H2 line.
 * The portion before the first H2 (the H1 + intro blockquote) becomes the
 * "intro" section that always posts first.
 */
function splitByH2(md: string): string[] {
  const lines = md.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current.length > 0) sections.push(current.join("\n").trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) sections.push(current.join("\n").trim());

  return sections.filter((s) => s.length > 0);
}

/**
 * Chunk a single section into <=MAX_CHUNK strings, breaking on paragraph
 * boundaries first, then on line boundaries, then hard-cutting as a last
 * resort. Each chunk after the first prepends "(continued)" so the reader
 * follows the thread.
 */
function chunkSection(section: string): string[] {
  if (section.length <= MAX_CHUNK) return [section];

  const out: string[] = [];
  const paragraphs = section.split(/\n\s*\n/);
  let buf = "";

  const flush = () => {
    if (buf.trim().length > 0) {
      out.push(buf.trim());
      buf = "";
    }
  };

  for (const p of paragraphs) {
    const candidate = buf.length > 0 ? `${buf}\n\n${p}` : p;
    if (candidate.length <= MAX_CHUNK) {
      buf = candidate;
      continue;
    }

    // Paragraph overflows current chunk
    flush();

    if (p.length <= MAX_CHUNK) {
      buf = p;
      continue;
    }

    // Single paragraph too big — break by line
    const lines = p.split("\n");
    let lineBuf = "";
    for (const line of lines) {
      const candidateLine = lineBuf.length > 0 ? `${lineBuf}\n${line}` : line;
      if (candidateLine.length <= MAX_CHUNK) {
        lineBuf = candidateLine;
        continue;
      }
      if (lineBuf.length > 0) {
        out.push(lineBuf);
        lineBuf = "";
      }
      if (line.length <= MAX_CHUNK) {
        lineBuf = line;
        continue;
      }
      // Single line too big — hard cut
      let i = 0;
      while (i < line.length) {
        out.push(line.slice(i, i + MAX_CHUNK));
        i += MAX_CHUNK;
      }
    }
    if (lineBuf.length > 0) buf = lineBuf;
  }

  flush();

  // Prefix subsequent chunks with "(continued)" so threading is obvious
  return out.map((c, i) => (i === 0 ? c : `_(continued)_\n${c}`));
}

async function main() {
  const { file } = parseArgs();

  console.log(`📄 Reading ${file}`);
  const md = await readFile(file, "utf-8");
  console.log(`   ${md.length} chars, ${md.split("\n").length} lines`);

  const sections = splitByH2(md);
  console.log(`📑 Split into ${sections.length} sections`);

  const allChunks = sections.flatMap((s) => chunkSection(s));
  console.log(`✂️  Chunked into ${allChunks.length} Discord messages\n`);

  // Light client — only Guilds intent, no message content
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  await new Promise<void>((resolveReady, rejectReady) => {
    client.once("ready", () => resolveReady());
    client.once("error", rejectReady);
    client
      .login(env.DISCORD_BOT_TOKEN)
      .catch(rejectReady);
  });

  console.log(`🤖 Logged in as ${client.user?.tag}`);

  const ch = await client.channels.fetch(env.DISCORD_BOT_CHANNEL_ID);
  if (!(ch instanceof TextChannel)) {
    throw new Error(
      `Channel ${env.DISCORD_BOT_CHANNEL_ID} is not a TextChannel`,
    );
  }
  console.log(`📡 Target channel: #${ch.name} (${ch.id})\n`);

  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i]!;
    const preview = chunk.slice(0, 60).replace(/\n/g, " ");
    console.log(`  [${i + 1}/${allChunks.length}] (${chunk.length} chars) ${preview}…`);
    await ch.send(chunk);
    if (i < allChunks.length - 1) {
      // 500ms between messages to be polite to the rate limiter
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`\n✅ Posted ${allChunks.length} messages to #${ch.name}`);

  await client.destroy();
}

main().catch((err) => {
  console.error("❌ Fatal:", err);
  process.exit(1);
});
