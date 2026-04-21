/**
 * Backfill anthropic_file_id on every knowledge_document that does NOT have
 * one yet. Downloads the blob from Supabase Storage, uploads to Anthropic's
 * Files API, stores the returned id. Runs from a local shell with service-
 * role credentials loaded via load-app-env.ts.
 *
 * Usage:  pnpm tsx scripts/backfill-anthropic-file-ids.ts [--dry-run] [--id=<uuid>]
 *
 * --dry-run: list what would be uploaded, upload nothing
 * --id=<uuid>: only process one document
 */

import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

import { loadBasquioScriptEnv } from "./load-app-env";

loadBasquioScriptEnv();

const FILES_API_BETA = "files-api-2025-04-14";

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("Missing Supabase credentials.");
    process.exit(1);
  }
  if (!anthropicKey) {
    console.error("Missing ANTHROPIC_API_KEY.");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  const idArg = process.argv.find((a) => a.startsWith("--id="))?.slice("--id=".length);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  let query = db
    .from("knowledge_documents")
    .select("id, filename, file_type, storage_path, file_size_bytes, status")
    .is("anthropic_file_id", null)
    .neq("status", "deleted")
    .order("created_at", { ascending: false })
    .limit(200);
  if (idArg) query = query.eq("id", idArg);

  const { data: rows, error } = await query;
  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }
  const docs = (rows ?? []) as Array<{
    id: string;
    filename: string;
    file_type: string;
    storage_path: string;
    file_size_bytes: number;
    status: string;
  }>;

  console.log(`Found ${docs.length} documents without anthropic_file_id.`);
  if (docs.length === 0) return;

  let ok = 0;
  let failed = 0;
  for (const doc of docs) {
    console.log(
      `  [${doc.id.slice(0, 8)}] ${doc.filename} (${doc.status}, ${Math.round((doc.file_size_bytes ?? 0) / 1024)} KB)`,
    );
    if (dryRun) continue;

    try {
      const { data: blob, error: dlError } = await db.storage
        .from("knowledge-base")
        .download(doc.storage_path);
      if (dlError || !blob) {
        console.log(`    ✗ storage download failed: ${dlError?.message ?? "no body"}`);
        failed += 1;
        continue;
      }
      const buffer = Buffer.from(await blob.arrayBuffer());

      const uploaded = await anthropic.beta.files.upload({
        file: await toFile(buffer, doc.filename, {
          type: guessContentType(doc.file_type),
        }),
        betas: [FILES_API_BETA],
      });
      const fileId = (uploaded as { id?: string | null })?.id ?? null;
      if (!fileId) {
        console.log(`    ✗ upload returned no id`);
        failed += 1;
        continue;
      }

      const { error: updateError } = await db
        .from("knowledge_documents")
        .update({
          anthropic_file_id: fileId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", doc.id);
      if (updateError) {
        console.log(`    ✗ update failed: ${updateError.message}`);
        failed += 1;
        continue;
      }

      console.log(`    ✓ ${fileId}`);
      ok += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`    ✗ ${msg}`);
      failed += 1;
    }
  }

  console.log(`\nDone. ${ok} uploaded, ${failed} failed, ${docs.length - ok - failed} skipped.`);
}

function guessContentType(ext: string): string {
  const lower = (ext ?? "").toLowerCase();
  if (lower === "pdf") return "application/pdf";
  if (lower === "docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower === "xlsx")
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower === "xls") return "application/vnd.ms-excel";
  if (lower === "csv") return "text/csv";
  if (lower === "md" || lower === "txt") return "text/plain";
  if (lower === "json") return "application/json";
  return "application/octet-stream";
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
