import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { tool } from "ai";
import { z } from "zod";

import { createFirecrawlClient } from "@basquio/research";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_ORG_ID, BASQUIO_TEAM_WORKSPACE_ID } from "@/lib/workspace/constants";
import { recordConversationAttachment } from "@/lib/workspace/conversation-attachments";
import { extractEntitiesFromDocument } from "@/lib/workspace/extraction";
import {
  deleteExtractionCacheEntry,
  getExtractionCacheEntry,
  putExtractionCacheEntry,
  type ExtractionSourceHint,
} from "@/lib/workspace/extraction-cache";
import { persistExtraction } from "@/lib/workspace/process";
import type { AgentCallContext } from "@/lib/workspace/agent-tools";

/**
 * Chat ingest tools per spec §6.1 and §6.2.
 *
 * saveFromPaste and scrapeUrl both follow the dry-run -> approval ->
 * persist flow:
 *  1. dry_run: true runs the extractor and caches the result keyed by
 *     extraction_id. The chat renders an ExtractionApprovalCard.
 *  2. A [Save all] button on the card triggers a follow-up tool call
 *     with dry_run: false and the extraction_id. The handler reuses the
 *     cached extraction, creates a synthetic knowledge_documents row,
 *     persists entities/facts via persistExtraction, and links the doc
 *     to the conversation so it surfaces in future retrievals.
 *
 * Non-fatal posture: the firecrawl call, the extractor, the storage
 * upload, and the persist step each catch-and-report. A partial write
 * never leaves the chat hung on an error; the user sees a clear
 * message and can retry.
 */

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

const CHAT_PASTE_STORAGE_BUCKET = "knowledge-base";

export function saveFromPasteTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Save a paste (email, transcript, meeting note, document body) the user just dropped into chat. Default behavior runs in dry-run mode: the tool extracts entities and facts and returns an approval card. On user approval, the follow-up call with dry_run: false persists everything.",
    inputSchema: z.object({
      text: z.string().min(10).max(50_000).optional(),
      source_hint: z
        .enum(["email", "transcript", "meeting_note", "chat_paste", "document", "other"])
        .default("chat_paste"),
      source_label: z.string().max(120).optional(),
      scope_id: z.string().uuid().optional(),
      dry_run: z.boolean().default(true),
      extraction_id: z.string().uuid().optional(),
    }),
    execute: async (input) => {
      // Persistence path (approval follow-up): fetch the cached dry-run
      // result by extraction_id, skip a second Haiku call.
      if (input.dry_run === false) {
        if (!input.extraction_id) {
          return {
            ok: false,
            stage: "persist",
            error:
              "Missing extraction_id on the persist call. Pass the extraction_id returned by the dry-run invocation.",
          };
        }
        const cached = getExtractionCacheEntry(input.extraction_id);
        if (!cached) {
          return {
            ok: false,
            stage: "persist",
            error:
              "The extraction preview expired or was never created. Paste the content again to re-extract.",
          };
        }
        try {
          const result = await persistCachedExtraction(ctx, cached, "chat_paste");
          deleteExtractionCacheEntry(input.extraction_id);
          return {
            ok: true,
            stage: "persist",
            document_id: result.documentId,
            entity_count: result.entityCount,
            fact_count: result.factCount,
            attached_to_conversation: result.attachedToConversation,
          };
        } catch (err) {
          return {
            ok: false,
            stage: "persist",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      // Dry-run path: extract + cache. Never writes to DB.
      if (!input.text || input.text.trim().length < 10) {
        return {
          ok: false,
          stage: "dry_run",
          error: "Paste too short to extract. Need at least 10 characters of content.",
        };
      }

      const sourceLabel = input.source_label ?? input.source_hint;
      try {
        const extraction = await extractEntitiesFromDocument(input.text, sourceLabel);
        const entry = putExtractionCacheEntry({
          workspaceId: ctx.workspaceId,
          scopeId: input.scope_id ?? ctx.currentScopeId ?? null,
          text: input.text,
          sourceHint: input.source_hint as ExtractionSourceHint,
          sourceLabel: input.source_label ?? null,
          conversationId: ctx.conversationId,
          sourceUrl: null,
          result: extraction,
        });
        return {
          ok: true,
          stage: "dry_run",
          extraction_id: entry.extractionId,
          preview: {
            source_hint: input.source_hint,
            source_label: sourceLabel,
            entity_count: extraction.entities.length,
            fact_count: extraction.facts.length,
            entities: extraction.entities.slice(0, 15).map((e) => ({
              type: e.type,
              canonical_name: e.canonical_name,
              role: e.role ?? null,
              description: e.description ?? null,
            })),
            facts: extraction.facts.slice(0, 15).map((f) => ({
              subject: f.subject_canonical_name,
              predicate: f.predicate,
              object_value: f.object_value,
              valid_from: f.valid_from ?? null,
              confidence: f.confidence,
            })),
          },
        };
      } catch (err) {
        return {
          ok: false,
          stage: "dry_run",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}

export function scrapeUrlTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Scrape a URL the user just dropped in chat and save it into the workspace. Dry-run mode (default) fetches the URL via Firecrawl, extracts entities and facts, and returns an approval card. On approval the follow-up dry_run: false call persists the article.",
    inputSchema: z.object({
      url: z.string().url().optional(),
      scope_id: z.string().uuid().optional(),
      note: z.string().max(500).optional(),
      dry_run: z.boolean().default(true),
      extraction_id: z.string().uuid().optional(),
    }),
    execute: async (input) => {
      if (input.dry_run === false) {
        if (!input.extraction_id) {
          return {
            ok: false,
            stage: "persist",
            error: "Missing extraction_id on the persist call.",
          };
        }
        const cached = getExtractionCacheEntry(input.extraction_id);
        if (!cached) {
          return {
            ok: false,
            stage: "persist",
            error: "The scrape preview expired. Drop the URL again to re-scrape.",
          };
        }
        try {
          const result = await persistCachedExtraction(ctx, cached, "chat_url");
          deleteExtractionCacheEntry(input.extraction_id);
          return {
            ok: true,
            stage: "persist",
            document_id: result.documentId,
            source_url: cached.sourceUrl,
            entity_count: result.entityCount,
            fact_count: result.factCount,
            attached_to_conversation: result.attachedToConversation,
          };
        } catch (err) {
          return {
            ok: false,
            stage: "persist",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      if (!input.url) {
        return { ok: false, stage: "dry_run", error: "url is required in dry-run mode" };
      }
      const firecrawlKey = process.env.FIRECRAWL_API_KEY;
      if (!firecrawlKey) {
        return {
          ok: false,
          stage: "dry_run",
          error: "FIRECRAWL_API_KEY is not configured on this deployment.",
        };
      }

      try {
        const firecrawl = createFirecrawlClient({ apiKey: firecrawlKey });
        const scrape = await firecrawl.scrape({
          url: input.url,
          options: { formats: ["markdown"], onlyMainContent: true },
        });
        const markdown = scrape.data?.markdown?.trim() ?? "";
        if (!markdown) {
          return {
            ok: false,
            stage: "dry_run",
            error: "Firecrawl returned no markdown content. The page may be JS-only or blocked.",
          };
        }
        const metaTitle = scrape.data?.metadata?.title;
        const title =
          typeof metaTitle === "string" && metaTitle.trim().length > 0
            ? metaTitle.trim()
            : new URL(input.url).hostname;
        const extraction = await extractEntitiesFromDocument(markdown, title);
        const entry = putExtractionCacheEntry({
          workspaceId: ctx.workspaceId,
          scopeId: input.scope_id ?? ctx.currentScopeId ?? null,
          text: markdown,
          sourceHint: "chat_url",
          sourceLabel: title,
          conversationId: ctx.conversationId,
          sourceUrl: input.url,
          result: extraction,
        });
        return {
          ok: true,
          stage: "dry_run",
          extraction_id: entry.extractionId,
          source_url: input.url,
          title,
          preview: {
            entity_count: extraction.entities.length,
            fact_count: extraction.facts.length,
            entities: extraction.entities.slice(0, 15).map((e) => ({
              type: e.type,
              canonical_name: e.canonical_name,
              role: e.role ?? null,
            })),
            facts: extraction.facts.slice(0, 15).map((f) => ({
              subject: f.subject_canonical_name,
              predicate: f.predicate,
              object_value: f.object_value,
              confidence: f.confidence,
            })),
          },
        };
      } catch (err) {
        return {
          ok: false,
          stage: "dry_run",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}

type PersistedExtractionSummary = {
  documentId: string;
  entityCount: number;
  factCount: number;
  attachedToConversation: boolean;
};

async function persistCachedExtraction(
  ctx: AgentCallContext,
  cached: ReturnType<typeof getExtractionCacheEntry> extends infer T
    ? Exclude<T, null>
    : never,
  kind: "chat_paste" | "chat_url",
): Promise<PersistedExtractionSummary> {
  const db = getDb();
  const documentId = randomUUID();
  const filename = buildFilename(cached, kind);
  const fileType = kind === "chat_url" ? "text/markdown" : "text/plain";
  const body = Buffer.from(cached.text, "utf8");
  const contentHash = createHash("sha256").update(body).digest("hex");
  const storagePath = `${kind}/${ctx.workspaceId}/${documentId}/${sanitizeFilename(filename)}`;

  // Upload the raw text body to storage so the document can be re-read
  // later by retrieveContext. If the bucket upload fails, do not insert
  // a knowledge_documents row: the downstream pipeline would leak a
  // row with no blob.
  const { error: uploadErr } = await db.storage
    .from(CHAT_PASTE_STORAGE_BUCKET)
    .upload(storagePath, body, { contentType: fileType, upsert: false });
  if (uploadErr) {
    throw new Error(`storage upload failed: ${uploadErr.message}`);
  }

  const metadata: Record<string, unknown> = {
    source_hint: cached.sourceHint,
    source_label: cached.sourceLabel,
    scope_id: cached.scopeId,
    ingested_via: "chat",
    ingested_by: ctx.userEmail,
  };
  if (kind === "chat_url" && cached.sourceUrl) {
    metadata.source_url = cached.sourceUrl;
  }

  const workspaceId = ctx.workspaceId ?? BASQUIO_TEAM_WORKSPACE_ID;
  const organizationId = ctx.organizationId ?? BASQUIO_TEAM_ORG_ID;
  const { error: insertErr } = await db.from("knowledge_documents").insert({
    id: documentId,
    workspace_id: workspaceId,
    organization_id: organizationId,
    is_team_beta: workspaceId === BASQUIO_TEAM_WORKSPACE_ID,
    kind,
    filename,
    file_type: fileType,
    file_size_bytes: body.byteLength,
    storage_path: storagePath,
    content_hash: contentHash,
    uploaded_by: ctx.userEmail,
    uploaded_by_discord_id: ctx.userEmail,
    upload_context: "chat",
    status: "processing",
    source_url: kind === "chat_url" ? cached.sourceUrl : null,
    metadata,
  });
  if (insertErr) {
    throw new Error(`knowledge_documents insert failed: ${insertErr.message}`);
  }

  let entityCount = 0;
  let factCount = 0;
  try {
    const persisted = await persistExtraction(documentId, cached.result);
    entityCount = persisted.totalMentionCount;
    factCount = persisted.factCount;
    await db
      .from("knowledge_documents")
      .update({
        status: "indexed",
        metadata: {
          ...metadata,
          entity_count: entityCount,
          fact_count: factCount,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
  } catch (err) {
    await db
      .from("knowledge_documents")
      .update({
        status: "failed",
        error_message:
          err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
    throw err;
  }

  let attached = false;
  if (ctx.conversationId) {
    try {
      const row = await recordConversationAttachment({
        conversationId: ctx.conversationId,
        documentId,
        workspaceId: ctx.workspaceId,
        origin: "chat-drop",
        uploadedBy: ctx.userEmail,
        metadata: { kind, ingested_via: "chat" },
      });
      attached = Boolean(row);
    } catch {
      // Non-fatal: the doc still surfaces via workspace retrieval.
    }
  }

  return {
    documentId,
    entityCount,
    factCount,
    attachedToConversation: attached,
  };
}

function buildFilename(
  cached: { sourceLabel: string | null; sourceUrl: string | null; sourceHint: string },
  kind: "chat_paste" | "chat_url",
): string {
  if (cached.sourceLabel) return ensureSuffix(cached.sourceLabel, kind);
  if (kind === "chat_url" && cached.sourceUrl) {
    try {
      const host = new URL(cached.sourceUrl).hostname;
      return ensureSuffix(`${host}-${new Date().toISOString().slice(0, 10)}`, kind);
    } catch {
      /* fall through */
    }
  }
  return ensureSuffix(
    `${cached.sourceHint}-${new Date().toISOString().slice(0, 10)}`,
    kind,
  );
}

function ensureSuffix(base: string, kind: "chat_paste" | "chat_url"): string {
  const ext = kind === "chat_url" ? ".md" : ".txt";
  if (base.endsWith(ext)) return base;
  return `${base}${ext}`;
}

function sanitizeFilename(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}
