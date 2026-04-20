import Link from "next/link";
import { notFound } from "next/navigation";

import { WorkspaceChat } from "@/components/workspace-chat/Chat";
import { SCOPE_KIND_LABELS, type ScopeKind } from "@/lib/workspace/constants";
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
    .limit(10);
  return data ?? [];
}

async function listScopeDeliverables(workspaceId: string, scopeId: string) {
  const db = getDb();
  const { data } = await db
    .from("workspace_deliverables")
    .select("id, title, kind, status, created_at")
    .eq("workspace_id", workspaceId)
    .eq("workspace_scope_id", scopeId)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(8);
  return data ?? [];
}

async function listScopeStakeholders(workspaceId: string, scopeName: string) {
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
      const role = String(entity.metadata?.role ?? "").toLowerCase();
      const company = String(entity.metadata?.company ?? "").toLowerCase();
      return company.includes(needle) || role.includes(needle);
    })
    .slice(0, 8)
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

  const [memory, deliverables, stakeholders] = await Promise.all([
    listScopeMemory(workspace.id, scope.id),
    listScopeDeliverables(workspace.id, scope.id),
    listScopeStakeholders(workspace.id, scope.name),
  ]);

  return (
    <div className="wbeta-workspace-layout">
      <section className="wbeta-chat-pane" aria-label={`Conversation scoped to ${scope.name}`}>
        <WorkspaceChat scopeId={scope.id} scopeName={scope.name} scopeKind={scope.kind} />
      </section>

      <aside className="wbeta-rail" aria-label={`Context for ${scope.name}`}>
        <header className="wbeta-rail-head">
          <div>
            <p className="wbeta-rail-kicker">{SCOPE_KIND_LABELS[scope.kind as RouteKind]}</p>
            <h2 className="wbeta-rail-title">{scope.name}</h2>
          </div>
        </header>

        <ul className="wbeta-rail-stats">
          <li>
            <span className="wbeta-rail-stat-num">{memory.length}</span>
            <span className="wbeta-rail-stat-label">Memory</span>
          </li>
          <li>
            <span className="wbeta-rail-stat-num">{stakeholders.length}</span>
            <span className="wbeta-rail-stat-label">People</span>
          </li>
          <li>
            <span className="wbeta-rail-stat-num">{deliverables.length}</span>
            <span className="wbeta-rail-stat-label">Answers</span>
          </li>
        </ul>

        <section className="wbeta-rail-section">
          <header className="wbeta-rail-section-head">
            <h3 className="wbeta-rail-section-title">Memory</h3>
            <span className="wbeta-rail-section-meta">
              {memory.length > 0 ? `${memory.length} entries` : "None yet"}
            </span>
          </header>
          {memory.length === 0 ? (
            <p className="wbeta-rail-empty">
              Teach Basquio a rule for {scope.name}. It applies to every question here.
            </p>
          ) : (
            <ul className="wbeta-rail-list">
              {memory.slice(0, 5).map((entry) => (
                <li key={entry.id}>
                  <Link href="/workspace/memory" className="wbeta-rail-item">
                    <span className="wbeta-rail-item-title">{shorten(entry.content as string, 90)}</span>
                    <span className="wbeta-rail-item-meta">{entry.memory_type}</span>
                  </Link>
                </li>
              ))}
              {memory.length > 5 ? (
                <li>
                  <Link href="/workspace/memory" className="wbeta-rail-more">
                    View all in memory
                  </Link>
                </li>
              ) : null}
            </ul>
          )}
        </section>

        <section className="wbeta-rail-section">
          <header className="wbeta-rail-section-head">
            <h3 className="wbeta-rail-section-title">Stakeholders</h3>
            <span className="wbeta-rail-section-meta">
              {stakeholders.length > 0 ? `${stakeholders.length} linked` : "None linked"}
            </span>
          </header>
          {stakeholders.length === 0 ? (
            <p className="wbeta-rail-empty">
              Stakeholders appear here when Basquio extracts them from {scope.name} uploads.
            </p>
          ) : (
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
          )}
        </section>

        <section className="wbeta-rail-section">
          <header className="wbeta-rail-section-head">
            <h3 className="wbeta-rail-section-title">Recent answers</h3>
            <span className="wbeta-rail-section-meta">
              {deliverables.length > 0 ? `${deliverables.length}` : "None yet"}
            </span>
          </header>
          {deliverables.length === 0 ? (
            <p className="wbeta-rail-empty">
              Answers scoped to {scope.name} collect here with cited sources.
            </p>
          ) : (
            <ul className="wbeta-rail-list">
              {deliverables.map((d) => (
                <li key={d.id}>
                  <Link href={`/workspace/deliverable/${d.id}`} className="wbeta-rail-item">
                    <span className="wbeta-rail-item-title">{d.title}</span>
                    <span className="wbeta-rail-item-meta">
                      {d.status === "ready"
                        ? "ready"
                        : d.status === "generating"
                          ? "generating"
                          : "needs attention"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}

function shorten(text: string, limit: number): string {
  const firstLine = text.split("\n").find((line) => line.trim().length > 0) ?? text;
  if (firstLine.length <= limit) return firstLine.trim();
  return firstLine.slice(0, limit - 1).trim() + "…";
}
