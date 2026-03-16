import { createHash } from "node:crypto";
import type { Message, Attachment } from "discord.js";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { parseFile } from "./parsers/index.js";
import { embedTexts } from "./embedder.js";
import {
  createDocument,
  insertChunks,
  updateDocumentStatus,
  findDocumentByHash,
  uploadKbFile,
} from "./supabase.js";
import { SUPPORTED_TYPES, MAX_FILE_SIZE } from "./kb-types.js";

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 100,
  separators: ["\n\n", "\n", ". ", " ", ""],
});

/**
 * Handle a file attachment dropped into #docs.
 * Full pipeline: download → dedup → store → parse → chunk → embed → insert.
 */
export async function handleDocsMessage(message: Message, attachment: Attachment): Promise<void> {
  const filename = attachment.name ?? "unknown";

  // Validate file size
  if (attachment.size > MAX_FILE_SIZE) {
    await message.react("⚠️");
    await message.reply(`File too large: **${filename}** (${Math.round(attachment.size / 1024 / 1024)}MB). Max is 25MB.`);
    return;
  }

  // Resolve file type — be permissive, let the parser decide if it can handle it
  const contentType = attachment.contentType ?? "";
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const fileType = SUPPORTED_TYPES[contentType] ?? (ext || "unknown");

  // Signal received
  await message.react("📥");

  let docId: string | undefined;

  try {
    // 1. Download
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());

    // 2. Dedup
    const contentHash = createHash("md5").update(buffer).digest("hex");
    const existing = await findDocumentByHash(contentHash);
    if (existing && existing.status === "indexed") {
      await message.react("♻️");
      await message.reply(`Already indexed: **${filename}**`);
      return;
    }

    // 3. Upload raw file to Supabase Storage
    const now = new Date();
    const storagePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${contentHash}-${filename}`;
    await uploadKbFile(buffer, storagePath, contentType);

    // 4. Create document record
    const uploadContext = message.content?.replace(/<[^>]+>/g, "").trim() || undefined;
    docId = await createDocument({
      filename,
      fileType,
      fileSizeBytes: buffer.length,
      storagePath,
      uploadedBy: message.author.displayName ?? message.author.username,
      uploadedByDiscordId: message.author.id,
      uploadContext,
      contentHash,
    });

    // 5. Parse
    const parsed = await parseFile(buffer, contentType, filename);
    if (!parsed.text.trim()) {
      await updateDocumentStatus(docId, "failed", { errorMessage: "No text extracted" });
      await message.react("❌");
      await message.reply(`Could not extract text from **${filename}**.`);
      return;
    }

    // 6. Chunk
    const chunks = await splitter.splitText(parsed.text);
    if (chunks.length === 0) {
      await updateDocumentStatus(docId, "failed", { errorMessage: "No chunks produced" });
      await message.react("❌");
      await message.reply(`No content found in **${filename}**.`);
      return;
    }

    // 7. Embed
    const embeddings = await embedTexts(chunks);

    // 8. Insert chunks
    const chunkRows = chunks.map((content: string, i: number) => ({
      content,
      embedding: embeddings[i],
      metadata: {
        ...(parsed.metadata.pageCount ? { total_pages: parsed.metadata.pageCount } : {}),
      },
    }));
    await insertChunks(docId, chunkRows);

    // 9. Finalize
    await updateDocumentStatus(docId, "indexed", {
      chunkCount: chunks.length,
      pageCount: parsed.metadata.pageCount,
    });

    await message.react("✅");
    const pageInfo = parsed.metadata.pageCount ? `, ${parsed.metadata.pageCount} pages` : "";
    await message.reply(`📚 Indexed **${filename}** — ${chunks.length} chunks${pageInfo}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Ingestion failed for ${filename}:`, errMsg);

    if (docId) {
      await updateDocumentStatus(docId, "failed", { errorMessage: errMsg }).catch(() => {});
    }

    try {
      await message.react("❌");
      await message.reply(`Failed to index **${filename}**: ${errMsg.slice(0, 200)}`);
    } catch {
      // Discord rate limit or message deleted — ignore
    }
  }
}
