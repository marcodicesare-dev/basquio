import Link from "next/link";
import { notFound } from "next/navigation";

import { WorkspaceChat } from "@/components/workspace-chat/Chat";
import { SCOPE_KIND_LABELS, type ScopeKind } from "@/lib/workspace/constants";
import { listConversations } from "@/lib/workspace/conversations";
import { getScopeByKindSlug } from "@/lib/workspace/scopes";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type RouteKind = Exclude<ScopeKind, "system">;
const ALLOWED: RouteKind[] = ["client", "category", "function"];

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

async function listScopeMemory(workspaceId: string, scopeId: string) {
  const db = getDb();
  const { data } = await db
    .from("memory_entries")
    .select("id, memory_type, path, content, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("workspace_scope_id", scopeId)
    .order("updated_at", { ascending: false })
    .limit(4);
  return data ?? [];
}

async function listScopeStakeholders(workspaceId: string, scopeId: string, scopeName: string) {
  const db = getDb();
  const { data } = await db
    .from("entities")
    .select("id, canonical_name, metadata")
    .eq("workspace_id", workspaceId)
    .eq("type", "person")
    .limit(200);
  const list = (data ?? []) as Array<{
    id: string;
    canonical_name: string;
    metadata: Record<string, unknown>;
  }>;
  const needle = scopeName.toLowerCase();
  return list
    .filter((entity) => {
      if (entity.metadata?.linked_scope_id === scopeId) return true;
      const role = String(entity.metadata?.role ?? "").toLowerCase();
      const company = String(entity.metadata?.company ?? "").toLowerCase();
      return company.includes(needle) || role.includes(needle);
    })
    .slice(0, 4)
    .map((entity) => ({
      id: entity.id,
      canonical_name: entity.canonical_name,
      role: extractRoleOnly(entity.metadata, scopeName),
    }));
}

function extractRoleOnly(metadata: Record<string, unknown>, scopeName: string): string | null {
  const role = metadata?.role as string | undefined;
  if (!role) return null;
  if (role.includes(",")) {
    const parts = role.split(",").map((s) => s.trim());
    const rest = parts.filter((p) => p.toLowerCase() !== scopeName.toLowerCase());
    if (rest.length > 0) return rest.join(", ");
  }
  return role;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kind: string; slug: string }>;
}) {
  const { kind, slug } = await params;
  const niceKind = kind.charAt(0).toUpperCase() + kind.slice(1);
  const niceSlug = slug.replace(/-/g, " ");
  return { title: `${niceSlug} · ${niceKind} · Basquio` };
}

function relativeTime(iso: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function WorkspaceScopePage({
  params,
}: {
  params: Promise<{ kind: string; slug: string }>;
}) {
  const { kind, slug } = await params;
  if (!ALLOWED.includes(kind as RouteKind)) notFound();

  const workspace = await getCurrentWorkspace();
  const scope = await getScopeByKindSlug(workspace.id, kind as RouteKind, slug);
  if (!scope) notFound();

  const [memory, conversations, stakeholders] = await Promise.all([
    listScopeMemory(workspace.id, scope.id),
    listConversations({ workspaceId: workspace.id, scopeId: scope.id, limit: 8 }).catch(() => []),
    listScopeStakeholders(workspace.id, scope.id, scope.name),
  ]);

  return (
    <div className="wbeta-workspace-layout">
      <section className="wbeta-chat-pane" aria-label={`Conversation scoped to ${scope.name}`}>
        <WorkspaceChat scopeId={scope.id} scopeName={scope.name} scopeKind={scope.kind} />
      </section>

      <aside className="wbeta-rail" aria-label={`Context for ${scope.name}`}>
        <section className="wbeta-rail-section">
          <header className="wbeta-rail-section-head">
            <h3 className="wbeta-rail-section-title">Recent chats</h3>
            <Link
              href={`/workspace/scope/${scope.kind}/${scope.slug}`}
              className="wbeta-rail-new-chat"
              aria-label="New chat"
            >
              New
            </Link>
          </header>
          {conversations.length === 0 ? (
            <p className="wbeta-rail-empty">
              No chats yet. Ask a question and it will show up here.
            </p>
          ) : (
            <ul className="wbeta-rail-list">
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link href={`/workspace/chat/${c.id}`} className="wbeta-rail-item">
                    <span className="wbeta-rail-item-title">{c.title ?? "Untitled"}</span>
                    <span className="wbeta-rail-item-meta">{relativeTime(c.last_message_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="wbeta-rail-section">
          <header className="wbeta-rail-section-head">
            <h3 className="wbeta-rail-section-title">Memory</h3>
            <span className="wbeta-rail-section-meta">{memory.length || "None"}</span>
          </header>
          {memory.length === 0 ? (
            <p className="wbeta-rail-empty">
              Teach Basquio a rule for {scope.name}. It applies here.
            </p>
          ) : (
            <ul className="wbeta-rail-list">
              {memory.map((entry) => (
                <li key={entry.id}>
                  <Link href="/workspace/memory" className="wbeta-rail-item">
                    <span className="wbeta-rail-item-title">{shorten(entry.content as string, 90)}</span>
                    <span className="wbeta-rail-item-meta">{entry.memory_type}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {stakeholders.length > 0 ? (
          <section className="wbeta-rail-section">
            <header className="wbeta-rail-section-head">
              <h3 className="wbeta-rail-section-title">Stakeholders</h3>
              <span className="wbeta-rail-section-meta">{stakeholders.length}</span>
            </header>
            <ul className="wbeta-rail-list">
              {stakeholders.map((person) => (
                <li key={person.id}>
                  <Link href={`/workspace/people/${person.id}`} className="wbeta-rail-item">
                    <span className="wbeta-rail-item-title">{person.canonical_name}</span>
                    {person.role ? (
                      <span className="wbeta-rail-item-meta">{person.role}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

function shorten(text: string, limit: number): string {
  const firstLine = text.split("\n").find((line) => line.trim().length > 0) ?? text;
  if (firstLine.length <= limit) return firstLine.trim();
  return firstLine.slice(0, limit - 1).trim() + "…";
}
