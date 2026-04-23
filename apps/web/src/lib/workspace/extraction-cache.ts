import "server-only";

import { randomUUID } from "node:crypto";

import type { EntityExtractionResult } from "./extraction";

/**
 * 5-minute in-memory cache for dry-run extractions produced by the
 * saveFromPaste and scrapeUrl chat tools per spec §6.1.
 *
 * Flow: dry_run: true runs extractEntitiesFromDocument and stashes the
 * result keyed by a new extraction_id. Chat renders an approval card.
 * On [Save all], the follow-up tool call passes the extraction_id back
 * with dry_run: false and we reuse the cached extraction instead of
 * paying a second Haiku call.
 *
 * Design choices:
 * - Per-worker process memory. The chat runtime is single-node behind
 *   Vercel edge + a Railway worker for deck gen; the web route that
 *   invokes these tools runs in a single Node lambda. Cross-region
 *   replication is a non-problem for v1.
 * - 5-minute TTL matches the approval-card interaction budget. The
 *   user either approves within minutes or the card goes stale and we
 *   recompute cheap.
 * - Entry cap 200. Above that the oldest entries are evicted. Prevents
 *   a memory leak if the process lives long.
 * - Entries store the full inputs needed for persistence (text, scope,
 *   workspace) so the dry_run: false path does not re-derive them from
 *   chat state.
 */

export type ExtractionSourceHint =
  | "email"
  | "transcript"
  | "meeting_note"
  | "chat_paste"
  | "document"
  | "other"
  | "chat_url";

export type ExtractionCacheEntry = {
  extractionId: string;
  workspaceId: string;
  scopeId: string | null;
  text: string;
  sourceHint: ExtractionSourceHint;
  sourceLabel: string | null;
  conversationId: string | null;
  sourceUrl: string | null;
  result: EntityExtractionResult;
  createdAt: number;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 200;

const cache = new Map<string, ExtractionCacheEntry>();

export function putExtractionCacheEntry(
  input: Omit<ExtractionCacheEntry, "extractionId" | "createdAt"> & {
    extractionId?: string;
    now?: number;
  },
): ExtractionCacheEntry {
  const extractionId = input.extractionId ?? randomUUID();
  const createdAt = input.now ?? Date.now();
  const entry: ExtractionCacheEntry = {
    extractionId,
    workspaceId: input.workspaceId,
    scopeId: input.scopeId,
    text: input.text,
    sourceHint: input.sourceHint,
    sourceLabel: input.sourceLabel,
    conversationId: input.conversationId,
    sourceUrl: input.sourceUrl,
    result: input.result,
    createdAt,
  };
  cache.set(extractionId, entry);
  sweepExpired(createdAt);
  enforceCap();
  return entry;
}

export function getExtractionCacheEntry(
  extractionId: string,
  opts: { now?: number; ttlMs?: number } = {},
): ExtractionCacheEntry | null {
  const entry = cache.get(extractionId);
  if (!entry) return null;
  const now = opts.now ?? Date.now();
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  if (now - entry.createdAt > ttl) {
    cache.delete(extractionId);
    return null;
  }
  return entry;
}

export function deleteExtractionCacheEntry(extractionId: string): boolean {
  return cache.delete(extractionId);
}

export function clearExtractionCache(): void {
  cache.clear();
}

export function extractionCacheSize(): number {
  return cache.size;
}

function sweepExpired(now: number, ttlMs = DEFAULT_TTL_MS): void {
  for (const [id, entry] of cache) {
    if (now - entry.createdAt > ttlMs) {
      cache.delete(id);
    }
  }
}

function enforceCap(): void {
  if (cache.size <= MAX_ENTRIES) return;
  const overflow = cache.size - MAX_ENTRIES;
  // Map preserves insertion order, so iterating from the start yields
  // the oldest entries first. Evict the overflow count.
  const toEvict: string[] = [];
  let i = 0;
  for (const id of cache.keys()) {
    if (i >= overflow) break;
    toEvict.push(id);
    i += 1;
  }
  for (const id of toEvict) cache.delete(id);
}
