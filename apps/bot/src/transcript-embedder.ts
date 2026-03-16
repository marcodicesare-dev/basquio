import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { embedTexts } from "./embedder.js";
import { insertTranscriptChunks, hasTranscriptChunks } from "./supabase.js";

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 100,
  separators: ["\n\n", "\n", ". ", " ", ""],
});

/**
 * Chunk and embed a transcript, then store in transcript_chunks.
 * Idempotent: skips if chunks already exist for this transcript.
 */
export async function embedAndStoreTranscript(
  transcriptId: string,
  rawTranscript: string,
): Promise<void> {
  if (!rawTranscript.trim()) return;

  // Skip if already embedded
  const exists = await hasTranscriptChunks(transcriptId);
  if (exists) return;

  // Chunk
  const chunks = await splitter.splitText(rawTranscript);
  if (chunks.length === 0) return;

  // Embed
  const embeddings = await embedTexts(chunks);

  // Extract speaker from each chunk (best-effort: look for "[Speaker X]:" pattern)
  const chunkRows = chunks.map((content: string, i: number) => {
    const speakerMatch = content.match(/^\[([^\]]+)\]/);
    return {
      content,
      embedding: embeddings[i],
      speaker: speakerMatch ? speakerMatch[1] : undefined,
      metadata: {},
    };
  });

  await insertTranscriptChunks(transcriptId, chunkRows);
  console.log(`📚 Embedded transcript ${transcriptId} — ${chunks.length} chunks`);
}
