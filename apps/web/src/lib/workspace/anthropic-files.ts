import "server-only";

import Anthropic, { toFile } from "@anthropic-ai/sdk";

/**
 * Thin wrapper around Anthropic's Files API (β files-api-2025-04-14).
 *
 * Why it exists: the file-in-chat execution-first architecture
 * (docs/specs/2026-04-21-file-in-chat-execution-first-architecture.md) needs
 * every uploaded file to be addressable via a `container_upload` content block
 * so the workspace agent can read it with pandas inside Claude's code-execution
 * container. The Files API id is stored on knowledge_documents.anthropic_file_id
 * and reused across chat turns and deck runs. Container_upload costs 0 input
 * tokens — the file bytes live on the container disk, not in the message.
 *
 * Best-effort in every error path. The upload chip and workspace knowledge both
 * survive an Anthropic API failure; we simply fall back to the pgvector
 * retrieval lane and log. The spec §10 lists Supabase Storage as the source of
 * truth — Anthropic is cache.
 */

const FILES_API_BETA = "files-api-2025-04-14";

/**
 * Upload a file buffer to the Anthropic Files API. Returns the file id on
 * success, null on any failure (caller continues without Layer A enabled).
 */
export async function uploadFileToAnthropic(input: {
  buffer: Buffer;
  filename: string;
  contentType?: string;
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[anthropic-files] ANTHROPIC_API_KEY not set — skipping upload");
    return null;
  }

  try {
    const client = new Anthropic({ apiKey });
    const file = await client.beta.files.upload({
      file: await toFile(input.buffer, input.filename, {
        type: input.contentType || "application/octet-stream",
      }),
      betas: [FILES_API_BETA],
    });
    return (file as { id?: string | null })?.id ?? null;
  } catch (error) {
    console.error(
      `[anthropic-files] upload failed for ${input.filename}`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Confirm an Anthropic Files API id still exists and is usable. Returns true
 * on success, false if the id has expired or never existed. Used by Layer A
 * agent-tool calls before they build container_upload blocks — if the id is
 * stale, the caller re-uploads from Supabase Storage (source of truth).
 */
export async function confirmAnthropicFile(fileId: string): Promise<boolean> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return false;
  try {
    const client = new Anthropic({ apiKey });
    await client.beta.files.retrieveMetadata(fileId, { betas: [FILES_API_BETA] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete an Anthropic Files API id. Fire-and-forget on document delete. Never
 * throws; caller shouldn't block on Anthropic-side cleanup.
 */
export async function deleteAnthropicFile(fileId: string): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;
  try {
    const client = new Anthropic({ apiKey });
    await client.beta.files.delete(fileId, { betas: [FILES_API_BETA] });
  } catch {
    // swallow — best-effort cleanup
  }
}
