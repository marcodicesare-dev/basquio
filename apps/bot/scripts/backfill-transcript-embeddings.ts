/**
 * One-time script to embed all existing transcripts into transcript_chunks
 * so they're searchable via hybrid search.
 *
 * Run: npx tsx scripts/backfill-transcript-embeddings.ts
 *
 * Idempotent: skips transcripts that already have chunks.
 */

import dotenv from "dotenv";
dotenv.config({ override: true });

import { getAllTranscripts, hasTranscriptChunks } from "../src/supabase.js";
import { embedAndStoreTranscript } from "../src/transcript-embedder.js";

async function main() {
  console.log("🔄 Starting transcript backfill...");

  const transcripts = await getAllTranscripts();
  console.log(`Found ${transcripts.length} transcripts`);

  let processed = 0;
  let skipped = 0;

  for (const t of transcripts) {
    // Skip if already embedded
    const exists = await hasTranscriptChunks(t.id);
    if (exists) {
      skipped++;
      continue;
    }

    if (!t.raw_transcript?.trim()) {
      skipped++;
      continue;
    }

    try {
      await embedAndStoreTranscript(t.id, t.raw_transcript);
      processed++;
      console.log(`✅ Backfilled transcript ${t.id} (${processed}/${transcripts.length - skipped})`);
    } catch (err) {
      console.error(`❌ Failed to backfill transcript ${t.id}:`, err);
    }
  }

  console.log(`\n🏁 Done. Processed: ${processed}, Skipped: ${skipped}, Total: ${transcripts.length}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
