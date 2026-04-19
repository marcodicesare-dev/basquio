import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_ORG_ID } from "@/lib/workspace/constants";
import { embedTexts } from "@/lib/workspace/embeddings";
import {
  extractEntitiesFromDocument,
  normalizeEntityName,
  type EntityExtractionResult,
} from "@/lib/workspace/extraction";
import { chunkText, parseDocument } from "@/lib/workspace/parsing";

type ProcessOutcome = {
  documentId: string;
  status: "indexed" | "failed";
  chunkCount: number;
  pageCount?: number;
  newEntityCount: number;
  factCount: number;
  mentionCount: number;
  error?: string;
};

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
    .select("id, filename, file_type, storage_path, content_hash")
    .eq("id", documentId)
    .eq("organization_id", BASQUIO_TEAM_ORG_ID)
    .eq("is_team_beta", true)
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
      const embeddings = await embedTexts(chunks);
      const chunkRows = chunks.map((content, i) => ({
        document_id: documentId,
        chunk_index: i,
        content,
        embedding: JSON.stringify(embeddings[i]),
        token_count: Math.ceil(content.length / 4),
        metadata: parsed.pageCount ? { total_pages: parsed.pageCount } : {},
        organization_id: BASQUIO_TEAM_ORG_ID,
        is_team_beta: true,
      }));
      const { error: chunkError } = await db.from("knowledge_chunks").insert(chunkRows);
      if (chunkError) {
        throw new Error(`Chunk insert failed: ${chunkError.message}`);
      }
      chunkRecordCount = chunkRows.length;
    }

    const extraction = await extractEntitiesFromDocument(text, doc.filename);
    const persisted = await persistExtraction(documentId, extraction);

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

async function persistExtraction(
  documentId: string,
  extraction: EntityExtractionResult,
): Promise<PersistResult> {
  const db = getServiceClient();

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
      .eq("organization_id", BASQUIO_TEAM_ORG_ID)
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
          organization_id: BASQUIO_TEAM_ORG_ID,
          is_team_beta: true,
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
            .eq("organization_id", BASQUIO_TEAM_ORG_ID)
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
          organization_id: BASQUIO_TEAM_ORG_ID,
          is_team_beta: true,
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
          organization_id: BASQUIO_TEAM_ORG_ID,
          is_team_beta: true,
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
