import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";

import { WorkspaceBreadcrumb } from "@/components/workspace-breadcrumb";
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

async function listScopeStakeholders(workspaceId: string, scopeSlug: string, scopeKind: RouteKind) {
  // Stakeholders linked to this scope via entities.metadata.linked_scope_id or via
  // a textual match in metadata.company (for client scopes). V2 task 4 lands a cleaner
  // entity->scope link; for now we bound the query to entities whose metadata.role
  // or metadata.company references the scope name.
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
  if (scopeKind !== "client") return list.slice(0, 6);
  const needle = scopeSlug.replace(/-/g, " ");
  return list
    .filter((entity) => {
      const role = String(entity.metadata?.role ?? "").toLowerCase();
      return role.includes(needle);
    })
    .slice(0, 6);
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
    listScopeStakeholders(workspace.id, scope.slug, scope.kind as RouteKind),
  ]);

  const totalMemory = memory.length;
  const totalDeliverables = deliverables.length;
  const totalStakeholders = stakeholders.length;

  return (
    <div className="wbeta-scope-page">
      <WorkspaceBreadcrumb
        items={[
          { href: "/workspace", label: "Home" },
          { label: SCOPE_KIND_LABELS[scope.kind as RouteKind] },
          { label: scope.name },
        ]}
      />

      <header className="wbeta-scope-head">
        <p className="wbeta-scope-eyebrow">{SCOPE_KIND_LABELS[scope.kind as RouteKind]}</p>
        <h1 className="wbeta-scope-title">{scope.name}</h1>
        <p className="wbeta-scope-summary">
          Working inside <strong>{scope.name}</strong>. Every question you ask on this page pulls
          context from this scope before anywhere else.
        </p>
      </header>

      <WorkspaceChat
        scopeId={scope.id}
        scopeName={scope.name}
        scopeKind={scope.kind}
      />

      <section className="wbeta-scope-panels">
        <article className="wbeta-scope-panel">
          <header className="wbeta-scope-panel-head">
            <h2 className="wbeta-scope-panel-title">Memory</h2>
            <p className="wbeta-scope-panel-meta">
              {totalMemory > 0 ? `${totalMemory} entries` : "No memory yet"}
            </p>
          </header>
          {memory.length === 0 ? (
            <p className="wbeta-scope-panel-empty">
              Teach Basquio a rule or preference for this scope. It will be applied every time you
              ask a question here.
            </p>
          ) : (
            <ul className="wbeta-scope-panel-list">
              {memory.slice(0, 5).map((entry) => (
                <li key={entry.id}>
                  <Link
                    href={`/workspace/memory?entry=${entry.id}`}
                    className="wbeta-scope-panel-row"
                  >
                    <span className="wbeta-scope-panel-row-kind">{entry.memory_type}</span>
                    <span className="wbeta-scope-panel-row-body" title={entry.content as string}>
                      {shorten(entry.content as string, 80)}
                    </span>
                  </Link>
                </li>
              ))}
              {memory.length > 5 ? (
                <li>
                  <Link href="/workspace/memory" className="wbeta-scope-panel-more">
                    View all <ArrowUpRight size={12} weight="bold" />
                  </Link>
                </li>
              ) : null}
            </ul>
          )}
        </article>

        <article className="wbeta-scope-panel">
          <header className="wbeta-scope-panel-head">
            <h2 className="wbeta-scope-panel-title">Stakeholders</h2>
            <p className="wbeta-scope-panel-meta">
              {totalStakeholders > 0 ? `${totalStakeholders} linked` : "None linked yet"}
            </p>
          </header>
          {stakeholders.length === 0 ? (
            <p className="wbeta-scope-panel-empty">
              Stakeholders appear here as Basquio extracts them from your uploads, or when you add
              them directly from the People page.
            </p>
          ) : (
            <ul className="wbeta-scope-panel-list">
              {stakeholders.map((person) => (
                <li key={person.id}>
                  <Link href={`/workspace/people/${person.id}`} className="wbeta-scope-panel-row">
                    <span className="wbeta-scope-panel-row-name">{person.canonical_name}</span>
                    {person.metadata?.role ? (
                      <span className="wbeta-scope-panel-row-meta">{String(person.metadata.role)}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="wbeta-scope-panel">
          <header className="wbeta-scope-panel-head">
            <h2 className="wbeta-scope-panel-title">Recent answers</h2>
            <p className="wbeta-scope-panel-meta">
              {totalDeliverables > 0 ? `${totalDeliverables} in this scope` : "Ask a question to begin"}
            </p>
          </header>
          {deliverables.length === 0 ? (
            <p className="wbeta-scope-panel-empty">
              Answers generated from this scope collect here with every cited source.
            </p>
          ) : (
            <ul className="wbeta-scope-panel-list">
              {deliverables.map((d) => (
                <li key={d.id}>
                  <Link href={`/workspace/deliverable/${d.id}`} className="wbeta-scope-panel-row">
                    <span className="wbeta-scope-panel-row-body">{d.title}</span>
                    <span className="wbeta-scope-panel-row-meta">
                      {d.status === "ready" ? "Ready" : d.status === "generating" ? "Generating" : "Needs attention"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </div>
  );
}

function shorten(text: string, limit: number): string {
  const firstLine = text.split("\n").find((line) => line.trim().length > 0) ?? text;
  if (firstLine.length <= limit) return firstLine.trim();
  return firstLine.slice(0, limit - 1).trim() + "…";
}
