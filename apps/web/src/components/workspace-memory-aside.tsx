import Link from "next/link";
import { PencilSimple, Sparkle, Trash } from "@phosphor-icons/react/dist/ssr";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { MEMORY_TYPE_LABELS, type MemoryType } from "@/lib/workspace/types";

/**
 * Workspace knowledge aside per shell spec §4.4.1 (Anthropic Memory
 * Tool pattern). Renders recent saves with source provenance so
 * Rossella sees what Basquio is writing to her workspace in real
 * time. Edit and delete affordances appear on hover per the Linear
 * "structure felt not seen" rule.
 *
 * Server component: fetches the last N writes across memory_entries,
 * knowledge_documents (kind=chat_paste / chat_url / scraped_article),
 * and entities. A single result stream keeps the UI honest about
 * what saved knowledge contains.
 *
 * V1 scope: rendering is read-only. Edit + delete wire to the
 * editRule / memory routes in a follow-up. The buttons exist in the
 * markup (muted) so the visual affordance is present.
 */

type RecentSave = {
  kind: "memory_rule" | "paste" | "url" | "scraped_article" | "person";
  label: string;
  sourceLabel: string;
  updatedAt: string;
  detailHref: string | null;
};

async function listRecentSaves(
  workspaceId: string,
  organizationId: string,
  limit = 8,
): Promise<RecentSave[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  const db = createServiceSupabaseClient(url, key);

  const [memoryRes, docsRes, peopleRes] = await Promise.all([
    db
      .from("memory_entries")
      .select("id, memory_type, content, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(limit),
    db
      .from("knowledge_documents")
      .select("id, filename, kind, source_url, updated_at")
      .eq("organization_id", organizationId)
      .in("kind", ["chat_paste", "chat_url", "scraped_article"])
      .order("updated_at", { ascending: false })
      .limit(limit),
    db
      .from("entities")
      .select("id, canonical_name, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("type", "person")
      .order("updated_at", { ascending: false })
      .limit(limit),
  ]);

  const saves: RecentSave[] = [];

  for (const row of memoryRes.data ?? []) {
    saves.push({
      kind: "memory_rule",
      label: truncate(String(row.content), 90),
      sourceLabel: memoryTypeLabel(row.memory_type),
      updatedAt: String(row.updated_at),
      detailHref: `/workspace/memory?entry=${row.id}`,
    });
  }
  for (const row of docsRes.data ?? []) {
    const kind = row.kind as "chat_paste" | "chat_url" | "scraped_article";
    const source =
      kind === "chat_paste"
        ? "Chat paste"
        : kind === "chat_url"
          ? "URL scrape"
          : "Research scrape";
    saves.push({
      kind: kind === "chat_paste" ? "paste" : kind === "chat_url" ? "url" : "scraped_article",
      label: truncate(String(row.filename ?? row.source_url ?? "(untitled)"), 90),
      sourceLabel: source,
      updatedAt: String(row.updated_at),
      detailHref: null,
    });
  }
  for (const row of peopleRes.data ?? []) {
    saves.push({
      kind: "person",
      label: String(row.canonical_name),
      sourceLabel: "Stakeholder",
      updatedAt: String(row.updated_at),
      detailHref: `/workspace/people/${row.id}`,
    });
  }

  saves.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return saves.slice(0, limit);
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1) + "…";
}

function relativeTime(iso: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export async function WorkspaceMemoryAside({
  workspaceId,
  organizationId,
}: {
  workspaceId: string;
  organizationId: string;
}) {
  const saves = await listRecentSaves(workspaceId, organizationId, 8);
  const thisWeekCount = saves.filter(
    (s) => Date.now() - new Date(s.updatedAt).getTime() < 7 * 24 * 3600_000,
  ).length;

  return (
    <aside className="wbeta-memory-aside" aria-label="Workspace knowledge">
      <header className="wbeta-memory-aside-head">
        <div className="wbeta-memory-aside-title-row">
          <Sparkle size={16} weight="regular" />
          <h3 className="wbeta-memory-aside-title">Workspace knowledge</h3>
        </div>
        <p className="wbeta-memory-aside-meta">
          {thisWeekCount} saved this week
        </p>
      </header>

      {saves.length === 0 ? (
        <p className="wbeta-memory-aside-empty">
          Knowledge will grow as you use Basquio.
        </p>
      ) : (
        <ul className="wbeta-memory-aside-list">
          {saves.map((save, i) => (
            <li key={`${save.kind}-${i}-${save.updatedAt}`} className="wbeta-memory-aside-item">
              <div className="wbeta-memory-aside-item-body">
                <p className="wbeta-memory-aside-item-label">{save.label}</p>
                <p className="wbeta-memory-aside-item-source">
                  {save.sourceLabel} · {relativeTime(save.updatedAt)}
                </p>
              </div>
              <div className="wbeta-memory-aside-item-actions" aria-hidden>
                {save.detailHref ? (
                  <Link
                    className="wbeta-memory-aside-action"
                    href={save.detailHref}
                    aria-label="Open"
                  >
                    <PencilSimple size={12} weight="regular" />
                  </Link>
                ) : null}
                <button
                  type="button"
                  className="wbeta-memory-aside-action"
                  disabled
                  aria-label="Delete (coming soon)"
                >
                  <Trash size={12} weight="regular" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="wbeta-memory-aside-foot">
        <Link className="wbeta-memory-aside-link" href="/workspace/memory">
          See all knowledge
        </Link>
      </footer>
    </aside>
  );
}

function memoryTypeLabel(value: unknown): string {
  if (value === "procedural" || value === "semantic" || value === "episodic") {
    return MEMORY_TYPE_LABELS[value as MemoryType];
  }
  return "Knowledge";
}
