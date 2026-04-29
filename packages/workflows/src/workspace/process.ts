import { createServiceSupabaseClient } from "../supabase";
import {
  BrandExtractionValidationError,
  runBrandGuidelineExtraction,
} from "./brand-extraction";
import { BASQUIO_TEAM_ORG_ID } from "./constants";
import { embedTexts } from "./embeddings";
import {
  extractEntitiesFromDocument,
  normalizeEntityName,
  type EntityExtractionResult,
} from "./extraction";
import { chunkText, parseDocument } from "./parsing";
import {
  composeContextualIndexText,
  generateContextualSummary,
  isContextualRetrievalEnabled,
} from "./contextual-retrieval";

type ProcessOutcome = {
  documentId: string;
  status: "indexed" | "failed";
  chunkCount: number;
  pageCount?: number;
  newEntityCount: number;
  factCount: number;
  mentionCount: number;
  brandExtraction?: {
    status: "success" | "failure" | "skipped";
    workflowRunId?: string;
    brandGuidelineId?: string;
    reason?: string;
  };
  error?: string;
};

function isBrandExtractionEnabled(): boolean {
  return process.env.BRAND_EXTRACTION_ENABLED === "true";
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

export async function processWorkspaceDocument(documentId: string): Promise<ProcessOutcome> {
  const db = getServiceClient();

  const { data: doc, error: fetchError } = await db
    .from("knowledge_documents")
    .select("id, filename, file_type, storage_path, content_hash, kind, workspace_id, organization_id")
    .eq("id", documentId)
    .single();

  if (fetchError || !doc) {
    throw new Error(`Document ${documentId} not found in workspace.`);
  }

  try {
    const { data: blob, error: dlError } = await db.storage
      .from("knowledge-base")
      .download(doc.storage_path);
    if (dlError || !blob) {
      throw new Error(`Storage download failed: ${dlError?.message ?? "no body"}`);
    }
    const buffer = Buffer.from(await blob.arrayBuffer());

    const parsed = await parseDocument(buffer, doc.file_type, blob.type);
    const text = parsed.text;
    if (!text) {
      await db
        .from("knowledge_documents")
        .update({
          status: "failed",
          error_message: "No text could be extracted from this file.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);
      return {
        documentId,
        status: "failed",
        chunkCount: 0,
        newEntityCount: 0,
        factCount: 0,
        mentionCount: 0,
        error: "No text extracted",
      };
    }

    const chunks = chunkText(text);
    let chunkRecordCount = 0;
    if (chunks.length > 0) {
      // Contextual Retrieval (Anthropic Sept 2024 pattern): generate a 50-100
      // word contextual summary per chunk via Haiku, then embed the
      // concatenated text. Best-effort , if the flag is off or the call
      // fails for a chunk we fall back to the raw content. Runs with mild
      // parallelism (batches of 8) to keep ingestion latency reasonable for
      // typical workspace docs.
      const contextualSummaries: Array<string | null> = new Array(chunks.length).fill(null);
      if (isContextualRetrievalEnabled()) {
        const BATCH = 8;
        for (let i = 0; i < chunks.length; i += BATCH) {
          const slice = chunks.slice(i, i + BATCH);
          const summaries = await Promise.all(
            slice.map((chunk) =>
              generateContextualSummary({
                documentTitle: doc.filename,
                documentText: text,
                chunk,
              }).catch(() => null),
            ),
          );
          for (let j = 0; j < summaries.length; j += 1) {
            contextualSummaries[i + j] = summaries[j];
          }
        }
      }

      const textsToEmbed = chunks.map((content, i) =>
        composeContextualIndexText(contextualSummaries[i], content),
      );
      const embeddings = await embedTexts(textsToEmbed);

      const indexedAtIso = new Date().toISOString();
      const chunkOrgId = doc.organization_id ?? BASQUIO_TEAM_ORG_ID;
      const chunkRows = chunks.map((content, i) => ({
        document_id: documentId,
        chunk_index: i,
        content,
        contextual_summary: contextualSummaries[i],
        embedding: JSON.stringify(embeddings[i]),
        token_count: Math.ceil(textsToEmbed[i].length / 4),
        metadata: parsed.pageCount ? { total_pages: parsed.pageCount } : {},
        organization_id: chunkOrgId,
        is_team_beta: chunkOrgId === BASQUIO_TEAM_ORG_ID,
        indexed_at: indexedAtIso,
      }));

      // Batch inserts so large documents (6MB CSV → 5000+ chunks × 1536-dim
      // vectors) don't blow the Postgres statement_timeout. Prior version used
      // a single insert and timed out on every file > ~1 MB. The stored
      // fts_contextual generated column recomputes per row, which adds CPU
      // cost , smaller batches keep each statement well inside the timeout.
      const CHUNK_INSERT_BATCH = 200;
      for (let i = 0; i < chunkRows.length; i += CHUNK_INSERT_BATCH) {
        const slice = chunkRows.slice(i, i + CHUNK_INSERT_BATCH);
        const { error: chunkError } = await db.from("knowledge_chunks").insert(slice);
        if (chunkError) {
          throw new Error(
            `Chunk insert failed at batch ${Math.floor(i / CHUNK_INSERT_BATCH)}: ${chunkError.message}`,
          );
        }
      }
      chunkRecordCount = chunkRows.length;
    }

    const extraction = await extractEntitiesFromDocument(text, doc.filename);
    const persisted = await persistExtraction(documentId, extraction, {
      organizationId: doc.organization_id ?? BASQUIO_TEAM_ORG_ID,
    });

    // Brand-book post-ingest hook (Memory v1 Brief 3, Option C wiring).
    // Runs ONLY when the user marked this document as a brand book at upload
    // time AND the BRAND_EXTRACTION_ENABLED flag is on. Failure does not
    // fail the overall ingest; chunks are already indexed for hybrid search.
    let brandExtraction: ProcessOutcome["brandExtraction"];
    if (doc.kind === "brand_book") {
      if (isBrandExtractionEnabled()) {
        try {
          const result = await runBrandGuidelineExtraction(db, {
            workspaceId: doc.workspace_id ?? doc.organization_id ?? BASQUIO_TEAM_ORG_ID,
            organizationId: doc.organization_id ?? BASQUIO_TEAM_ORG_ID,
            documentId,
            pdfText: text,
            pageCount: parsed.pageCount ?? 0,
            actor: "system:workflow:brand-extraction",
          });
          brandExtraction = {
            status: "success",
            workflowRunId: result.workflowRunId,
            brandGuidelineId: result.brandGuidelineId,
          };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          const validationFailure = err instanceof BrandExtractionValidationError;
          console.error(
            `[brand-extraction] documentId=${documentId} failed (${
              validationFailure ? "validation" : "runtime"
            }): ${reason}`,
          );
          brandExtraction = { status: "failure", reason };
        }
      } else {
        brandExtraction = { status: "skipped", reason: "BRAND_EXTRACTION_ENABLED=false" };
      }
    }

    await db
      .from("knowledge_documents")
      .update({
        status: "indexed",
        chunk_count: chunkRecordCount,
        page_count: parsed.pageCount ?? null,
        error_message: null,
        metadata: {
          parsed_chars: text.length,
          entity_count: persisted.totalMentionCount,
          fact_count: persisted.factCount,
          ...(brandExtraction ? { brand_extraction: brandExtraction } : {}),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    return {
      documentId,
      status: "indexed",
      chunkCount: chunkRecordCount,
      pageCount: parsed.pageCount,
      newEntityCount: persisted.newEntityCount,
      factCount: persisted.factCount,
      mentionCount: persisted.totalMentionCount,
      brandExtraction,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .from("knowledge_documents")
      .update({
        status: "failed",
        error_message: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
    return {
      documentId,
      status: "failed",
      chunkCount: 0,
      newEntityCount: 0,
      factCount: 0,
      mentionCount: 0,
      error: message,
    };
  }
}

type PersistResult = {
  newEntityCount: number;
  factCount: number;
  totalMentionCount: number;
};

export async function persistExtraction(
  documentId: string,
  extraction: EntityExtractionResult,
  ctx: { organizationId?: string } = {},
): Promise<PersistResult> {
  const db = getServiceClient();
  const organizationId = ctx.organizationId ?? BASQUIO_TEAM_ORG_ID;
  const isTeamBetaScope = organizationId === BASQUIO_TEAM_ORG_ID;

  if (extraction.entities.length === 0 && extraction.facts.length === 0) {
    return { newEntityCount: 0, factCount: 0, totalMentionCount: 0 };
  }

  const seen = new Map<string, { type: string; canonical_name: string; aliases: string[]; description?: string; role?: string }>();
  for (const entity of extraction.entities) {
    const key = `${entity.type}::${normalizeEntityName(entity.canonical_name)}`;
    const existing = seen.get(key);
    if (existing) {
      const merged = new Set([...existing.aliases, ...entity.aliases]);
      existing.aliases = Array.from(merged);
      existing.description = existing.description ?? entity.description;
      existing.role = existing.role ?? entity.role;
    } else {
      seen.set(key, {
        type: entity.type,
        canonical_name: entity.canonical_name,
        aliases: [...entity.aliases],
        description: entity.description,
        role: entity.role,
      });
    }
  }

  for (const fact of extraction.facts) {
    const key = `${fact.subject_type}::${normalizeEntityName(fact.subject_canonical_name)}`;
    if (!seen.has(key)) {
      seen.set(key, {
        type: fact.subject_type,
        canonical_name: fact.subject_canonical_name,
        aliases: [],
      });
    }
    if (fact.object_canonical_name && fact.object_type) {
      const objKey = `${fact.object_type}::${normalizeEntityName(fact.object_canonical_name)}`;
      if (!seen.has(objKey)) {
        seen.set(objKey, {
          type: fact.object_type,
          canonical_name: fact.object_canonical_name,
          aliases: [],
        });
      }
    }
  }

  const entityKeyToId = new Map<string, string>();
  let newEntityCount = 0;

  for (const [key, entity] of seen) {
    const normalized = normalizeEntityName(entity.canonical_name);
    const { data: existing, error: lookupError } = await db
      .from("entities")
      .select("id, aliases, metadata")
      .eq("organization_id", organizationId)
      .eq("type", entity.type)
      .eq("normalized_name", normalized)
      .maybeSingle();
    if (lookupError) {
      throw new Error(`Entity lookup failed: ${lookupError.message}`);
    }

    if (existing) {
      entityKeyToId.set(key, existing.id as string);
      const mergedAliases = Array.from(new Set([...(existing.aliases ?? []), ...entity.aliases]));
      const mergedMeta = {
        ...((existing.metadata as Record<string, unknown>) ?? {}),
        ...(entity.role ? { role: entity.role } : {}),
        ...(entity.description ? { description: entity.description } : {}),
      };
      if (mergedAliases.length !== (existing.aliases ?? []).length || Object.keys(mergedMeta).length > 0) {
        await db
          .from("entities")
          .update({
            aliases: mergedAliases,
            metadata: mergedMeta,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      }
    } else {
      const { data: inserted, error: insertError } = await db
        .from("entities")
        .insert({
          organization_id: organizationId,
          is_team_beta: isTeamBetaScope,
          type: entity.type,
          canonical_name: entity.canonical_name,
          normalized_name: normalized,
          aliases: entity.aliases,
          metadata: {
            ...(entity.role ? { role: entity.role } : {}),
            ...(entity.description ? { description: entity.description } : {}),
          },
        })
        .select("id")
        .single();
      if (insertError) {
        // Race: another concurrent extraction inserted the same (org, type, normalized_name).
        // Re-fetch and treat as existing.
        if (insertError.code === "23505") {
          const { data: raced } = await db
            .from("entities")
            .select("id")
            .eq("organization_id", organizationId)
            .eq("type", entity.type)
            .eq("normalized_name", normalized)
            .maybeSingle();
          if (raced) {
            entityKeyToId.set(key, raced.id as string);
            continue;
          }
        }
        throw new Error(`Entity insert failed: ${insertError.message}`);
      }
      if (!inserted) {
        throw new Error("Entity insert returned no row.");
      }
      entityKeyToId.set(key, inserted.id as string);
      newEntityCount += 1;
    }
  }

  let mentionCount = 0;
  if (extraction.entities.length > 0) {
    const mentionRows = extraction.entities
      .map((entity) => {
        const key = `${entity.type}::${normalizeEntityName(entity.canonical_name)}`;
        const entityId = entityKeyToId.get(key);
        if (!entityId) return null;
        return {
          organization_id: organizationId,
          is_team_beta: isTeamBetaScope,
          entity_id: entityId,
          source_type: "document",
          source_id: documentId,
          excerpt: entity.description ?? null,
          confidence: 1,
          metadata: {
            ...(entity.role ? { role: entity.role } : {}),
            aliases: entity.aliases,
          },
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (mentionRows.length > 0) {
      const { error: mentionError } = await db.from("entity_mentions").insert(mentionRows);
      if (mentionError) {
        throw new Error(`Entity mention insert failed: ${mentionError.message}`);
      }
      mentionCount = mentionRows.length;
    }
  }

  let factCount = 0;
  if (extraction.facts.length > 0) {
    const factRows = extraction.facts
      .map((fact) => {
        const subjectKey = `${fact.subject_type}::${normalizeEntityName(fact.subject_canonical_name)}`;
        const subjectId = entityKeyToId.get(subjectKey);
        if (!subjectId) return null;
        const objectKey =
          fact.object_canonical_name && fact.object_type
            ? `${fact.object_type}::${normalizeEntityName(fact.object_canonical_name)}`
            : null;
        const objectId = objectKey ? entityKeyToId.get(objectKey) ?? null : null;

        const objectValue = typeof fact.object_value === "object" && fact.object_value !== null
          ? fact.object_value
          : { value: fact.object_value };

        return {
          organization_id: organizationId,
          is_team_beta: isTeamBetaScope,
          subject_entity: subjectId,
          predicate: fact.predicate,
          object_value: objectValue,
          object_entity: objectId,
          valid_from: parseValidTimestamp(fact.valid_from),
          valid_to: parseValidTimestamp(fact.valid_to),
          source_id: documentId,
          source_type: "document",
          confidence: fact.confidence,
          metadata: fact.evidence_excerpt ? { evidence: fact.evidence_excerpt } : {},
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (factRows.length > 0) {
      const { error: factError } = await db.from("facts").insert(factRows);
      if (factError) {
        throw new Error(`Fact insert failed: ${factError.message}`);
      }
      factCount = factRows.length;
    }
  }

  return { newEntityCount, factCount, totalMentionCount: mentionCount };
}

function parseValidTimestamp(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^\d{4}-\d{2}-\d{2}/);
  if (isoMatch) {
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const quarterMatch = trimmed.match(/^(\d{4})[-\s]*Q([1-4])$/i);
  if (quarterMatch) {
    const year = Number(quarterMatch[1]);
    const quarter = Number(quarterMatch[2]);
    const month = (quarter - 1) * 3;
    return new Date(Date.UTC(year, month, 1)).toISOString();
  }

  const yearMatch = trimmed.match(/^(\d{4})$/);
  if (yearMatch) {
    return new Date(Date.UTC(Number(yearMatch[1]), 0, 1)).toISOString();
  }

  return null;
}
