import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_ORG_ID } from "@/lib/workspace/constants";
import { listConversationAttachments } from "@/lib/workspace/conversation-attachments";
import { confirmAnthropicFile, uploadFileToAnthropic } from "@/lib/workspace/anthropic-files";
import { setDocumentAnthropicFileId } from "@/lib/workspace/db";

/**
 * Layer A of the file-in-chat execution-first architecture
 * (docs/specs/2026-04-21-file-in-chat-execution-first-architecture.md).
 *
 * Opens a Sonnet call with code_execution + web_fetch (web_fetch makes code
 * execution free) and streams all conversation attachments into the container
 * via container_upload content blocks. The sub-agent reads the files with
 * pandas/openpyxl, computes the answer, and returns a short cited markdown
 * response. No pgvector round trip.
 *
 * Returns a string the outer agent includes verbatim in its reply. On any
 * failure, returns a friendly fallback telling the agent to fall back to
 * retrieveContext — the call never throws.
 */

const FILES_API_BETA = "files-api-2025-04-14";
const CODE_EXECUTION_BETA = "code-execution-2025-08-25";
const ANALYZER_MODEL = process.env.BASQUIO_ANALYZER_MODEL ?? "claude-sonnet-4-5";

export type AnalyzeAttachedFileResult = {
  ok: boolean;
  answer: string | null;
  cited_files: string[];
  reason?: string;
};

export async function analyzeAttachedFile(input: {
  conversationId: string;
  question: string;
  /** Optional subset of document ids; if omitted, all conversation attachments are used. */
  documentIds?: string[];
  /**
   * Hard cap on the number of files passed into the container. Claude's
   * container has 5 GiB disk, so dozens of small files are fine, but we
   * want to keep the tool call fast — 6 by default.
   */
  maxFiles?: number;
}): Promise<AnalyzeAttachedFileResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      answer: null,
      cited_files: [],
      reason: "ANTHROPIC_API_KEY missing",
    };
  }

  const attachments = await listConversationAttachments(input.conversationId).catch(() => []);
  if (attachments.length === 0) {
    return {
      ok: false,
      answer: null,
      cited_files: [],
      reason: "no attachments",
    };
  }

  // Layer A does NOT require Lane B (chunk/embed) to have succeeded. Code
  // execution reads the raw file directly, so status='failed' documents are
  // still eligible as long as their blob survives and we can hand Claude an
  // anthropic_file_id (or re-upload from Supabase Storage). Only 'deleted'
  // docs are off-limits.
  const eligible = attachments.filter((a) => {
    if (a.status === "deleted") return false;
    if (input.documentIds && !input.documentIds.includes(a.document_id)) return false;
    return true;
  });
  if (eligible.length === 0) {
    return {
      ok: false,
      answer: null,
      cited_files: [],
      reason: "no eligible attachments",
    };
  }

  const maxFiles = input.maxFiles ?? 6;
  const selected = eligible.slice(0, maxFiles);

  // Ensure each selected doc has a usable anthropic_file_id. If any is missing
  // (e.g. upload predates Layer A, or Anthropic side expired), re-upload from
  // Supabase Storage. Supabase Storage stays the source of truth.
  const fileIdsByDoc = new Map<string, string>();
  for (const a of selected) {
    const fileId = await ensureAnthropicFileId({
      documentId: a.document_id,
      storagePath: a.storage_path,
      filename: a.filename ?? "file",
      fileType: a.file_type ?? null,
    }).catch(() => null);
    if (fileId) {
      fileIdsByDoc.set(a.document_id, fileId);
    }
  }

  if (fileIdsByDoc.size === 0) {
    return {
      ok: false,
      answer: null,
      cited_files: [],
      reason: "no anthropic file ids could be resolved",
    };
  }

  const filenamesInOrder: string[] = [];
  const containerBlocks: Array<{ type: "container_upload"; file_id: string }> = [];
  for (const a of selected) {
    const fileId = fileIdsByDoc.get(a.document_id);
    if (!fileId) continue;
    filenamesInOrder.push(a.filename ?? a.document_id);
    containerBlocks.push({ type: "container_upload", file_id: fileId });
  }

  const systemPrompt = `You are Basquio's data analyst co-pilot. The user's question is about specific files attached to their workspace chat. Use Python (pandas, openpyxl, numpy) in the code_execution tool to read the files and answer precisely.

Rules:
- Read files with pandas/openpyxl. Compute real numbers. Do not estimate.
- For CSVs larger than a few thousand rows, summarize with groupby/pivot, do not dump raw rows.
- Output exactly ONE short markdown answer. 3-6 sentences maximum. When the user asks for a table, output a tight Markdown GFM table (no more than 12 rows).
- Cite every number inline as [filename · operation]. Example: [Estrazione Item Pet 2025.csv · df.groupby('region').sum()].
- No AI slop (no "dive deep", "leverage", "unlock"). No em dashes. No emojis.
- If the question cannot be answered from the attached files, say so in one sentence and suggest what additional data would help.
- Italian or English: match the question's language.`;

  const userPrompt =
    `Files attached to this chat (in order):\n${filenamesInOrder
      .map((n, i) => `  ${i + 1}. ${n}`)
      .join("\n")}\n\n` +
    `User question:\n${input.question.slice(0, 2000)}\n\n` +
    `Use code_execution with pandas/openpyxl on the files above. Answer directly.`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.create({
      model: ANALYZER_MODEL,
      max_tokens: 2048,
      betas: [CODE_EXECUTION_BETA, FILES_API_BETA],
      system: systemPrompt,
      tools: [
        { type: "code_execution_20250825", name: "code_execution" },
      ] as unknown as Anthropic.Beta.Messages.BetaToolUnion[],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            ...containerBlocks,
          ] as unknown as Anthropic.Beta.Messages.BetaContentBlockParam[],
        },
      ],
    });

    const textBlocks = response.content.filter((b) => b.type === "text");
    const answer = textBlocks
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n\n")
      .trim();

    if (!answer) {
      return {
        ok: false,
        answer: null,
        cited_files: filenamesInOrder,
        reason: "empty response",
      };
    }

    return {
      ok: true,
      answer,
      cited_files: filenamesInOrder,
    };
  } catch (error) {
    console.error("[analyze-attached-file] sonnet call failed", error);
    return {
      ok: false,
      answer: null,
      cited_files: filenamesInOrder,
      reason: error instanceof Error ? error.message : "code_execution call failed",
    };
  }
}

/**
 * Make sure a document has a usable anthropic_file_id. If the stored id is
 * missing or stale, re-upload from Supabase Storage and persist the new id.
 */
async function ensureAnthropicFileId(input: {
  documentId: string;
  storagePath: string | null;
  filename: string;
  fileType: string | null;
}): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const db = createServiceSupabaseClient(url, key);

  const { data } = await db
    .from("knowledge_documents")
    .select("anthropic_file_id")
    .eq("id", input.documentId)
    .eq("organization_id", BASQUIO_TEAM_ORG_ID)
    .maybeSingle();

  const existing = (data as { anthropic_file_id: string | null } | null)?.anthropic_file_id ?? null;
  if (existing) {
    // Verify the id is still live before handing it back. Anthropic's Files
    // API rows have a TTL; a stale id would 4xx the code_execution call.
    const stillValid = await confirmAnthropicFile(existing);
    if (stillValid) return existing;
    // Stale — fall through to the re-upload path and persist the new id.
  }

  if (!input.storagePath) return null;

  const { data: blob, error } = await db.storage
    .from("knowledge-base")
    .download(input.storagePath);
  if (error || !blob) return null;

  const buffer = Buffer.from(await blob.arrayBuffer());
  const newId = await uploadFileToAnthropic({
    buffer,
    filename: input.filename,
    contentType: input.fileType ? guessContentType(input.fileType) : undefined,
  });
  if (!newId) return null;

  await setDocumentAnthropicFileId(input.documentId, newId).catch(() => {});
  return newId;
}

function guessContentType(ext: string): string {
  const lower = ext.toLowerCase();
  if (lower === "pdf") return "application/pdf";
  if (lower === "docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower === "pptx")
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower === "xlsx")
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower === "xls") return "application/vnd.ms-excel";
  if (lower === "csv") return "text/csv";
  if (lower === "md" || lower === "txt" || lower === "gsp") return "text/plain";
  if (lower === "json") return "application/json";
  if (lower === "png") return "image/png";
  if (lower === "jpg" || lower === "jpeg") return "image/jpeg";
  if (lower === "webp") return "image/webp";
  if (lower === "gif") return "image/gif";
  return "application/octet-stream";
}
