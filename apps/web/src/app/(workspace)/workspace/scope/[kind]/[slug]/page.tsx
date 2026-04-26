import { notFound } from "next/navigation";
import { headers } from "next/headers";

import { WorkspaceChat } from "@/components/workspace-chat/Chat";
import {
  ScopeChatShell,
  type ScopeDeliverable,
  type ScopeStakeholder,
  type WorkspaceKnowsSummary,
} from "@/components/scope-chat-shell";
import type { ScopeCommandAction } from "@/components/scope-command-palette";
import { WorkspaceMemoryAside } from "@/components/workspace-memory-aside";
import { resolveWorkspaceLocale } from "@/i18n";
import { BASQUIO_TEAM_ORG_ID, type ScopeKind } from "@/lib/workspace/constants";
import { listConversations } from "@/lib/workspace/conversations";
import { getScopeByKindSlug, listScopesGrouped } from "@/lib/workspace/scopes";
import { buildSuggestions } from "@/lib/workspace/suggestions";
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

function relativeResearchTime(iso: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) {
    const minutes = Math.floor(diff / 60);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (diff < 86400) {
    const hours = Math.floor(diff / 3600);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function countScopeFacts(workspaceId: string, scopeName: string): Promise<number> {
  const db = getDb();
  const { count } = await db
    .from("facts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .ilike("evidence", `%${scopeName}%`);
  return count ?? 0;
}

async function countScrapedArticlesForScope(): Promise<number> {
  const db = getDb();
  const { count } = await db
    .from("knowledge_documents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", BASQUIO_TEAM_ORG_ID)
    .eq("is_team_beta", true)
    .eq("kind", "scraped_article");
  return count ?? 0;
}

async function lastResearchLabel(workspaceId: string): Promise<string | null> {
  const db = getDb();
  const { data } = await db
    .from("research_runs")
    .select("completed_at, scrapes_succeeded")
    .eq("workspace_id", workspaceId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(1);
  const row = (data ?? [])[0] as { completed_at: string | null; scrapes_succeeded: number | null } | undefined;
  if (!row?.completed_at) return null;
  const when = relativeResearchTime(row.completed_at);
  const sources = row.scrapes_succeeded ?? 0;
  if (sources <= 0) return when;
  return `${when} from ${sources} source${sources === 1 ? "" : "s"}`;
}

export default async function WorkspaceScopePage({
  params,
}: {
  params: Promise<{ kind: string; slug: string }>;
}) {
  const { kind, slug } = await params;
  const headersList = await headers();
  const locale = resolveWorkspaceLocale(headersList.get("accept-language"));
  if (!ALLOWED.includes(kind as RouteKind)) notFound();

  const workspace = await getCurrentWorkspace();
  const scope = await getScopeByKindSlug(workspace.id, kind as RouteKind, slug);
  if (!scope) notFound();

  const [memory, conversations, stakeholdersRaw, factsCount, articlesCount, researchLabel, suggestions, scopeTree] = await Promise.all([
    listScopeMemory(workspace.id, scope.id),
    listConversations({ workspaceId: workspace.id, scopeId: scope.id, limit: 5 }).catch(() => []),
    listScopeStakeholders(workspace.id, scope.id, scope.name),
    countScopeFacts(workspace.id, scope.name).catch(() => 0),
    countScrapedArticlesForScope().catch(() => 0),
    lastResearchLabel(workspace.id).catch(() => null),
    buildSuggestions({
      maxItems: 3,
      scopeId: scope.id,
      scopeName: scope.name,
      locale,
    }).catch(() => []),
    listScopesGrouped(workspace.id).catch(() => ({ client: [], category: [], function: [], system: [] })),
  ]);

  const stakeholders: ScopeStakeholder[] = stakeholdersRaw.map((p) => ({
    id: p.id,
    name: p.canonical_name,
    role: p.role ?? null,
    preferenceQuote: null,
  }));

  const deliverables: ScopeDeliverable[] = conversations.map((c) => ({
    id: c.id,
    title: c.title ?? "Untitled chat",
    updatedAt: relativeTime(c.last_message_at),
    href: `/workspace/chat/${c.id}`,
  }));

  const workspaceKnows: WorkspaceKnowsSummary = {
    rulesCount: memory.length,
    factsCount,
    articlesCount,
    lastResearchLabel: researchLabel,
  };
  const effectiveSuggestions =
    suggestions.length > 0
      ? suggestions
      : [
          {
            id: `fallback-${scope.id}`,
            kind: "investigate" as const,
            prompt: `Ask what changed in ${scope.name} this week.`,
            reason: "Uses this scope's chats and saved context.",
          },
        ];
  const commandActions = buildCommandActions({
    scopeId: scope.id,
    scopeName: scope.name,
    scopeTree,
    deliverables,
  });

  return (
    <ScopeChatShell
      scope={scope}
      stakeholders={stakeholders}
      workspaceKnows={workspaceKnows}
      deliverables={deliverables}
      suggestions={effectiveSuggestions}
      commandActions={commandActions}
      chat={
        <WorkspaceChat
          scopeId={scope.id}
          scopeName={scope.name}
          scopeKind={scope.kind}
          locale={locale}
          compactEmpty
          contextGreeting={`What should we work through for ${scope.name}?`}
          promptSuggestions={effectiveSuggestions}
        />
      }
      memoryAside={<WorkspaceMemoryAside workspaceId={workspace.id} />}
      locale={locale}
    />
  );
}

function buildCommandActions({
  scopeId,
  scopeName,
  scopeTree,
  deliverables,
}: {
  scopeId: string;
  scopeName: string;
  scopeTree: Awaited<ReturnType<typeof listScopesGrouped>>;
  deliverables: ScopeDeliverable[];
}): ScopeCommandAction[] {
  const scopeActions = [...scopeTree.client, ...scopeTree.category, ...scopeTree.function]
    .filter((scope) => scope.id !== scopeId)
    .slice(0, 12)
    .map((scope) => ({
      id: `scope-${scope.id}`,
      group: "Switch scope",
      label: scope.name,
      href: `/workspace/scope/${scope.kind}/${scope.slug}`,
      hint: scope.kind,
    }));
  return [
    {
      id: "memory",
      group: "Open",
      label: `${scopeName} knowledge`,
      href: "/workspace/memory",
      hint: "Saved knowledge",
    },
    {
      id: "people",
      group: "Open",
      label: `${scopeName} people`,
      href: `/workspace/people?scope=${scopeId}`,
      hint: "People and preferences",
    },
    ...deliverables.slice(0, 5).map((deliverable) => ({
      id: `deliverable-${deliverable.id}`,
      group: "Chat",
      label: deliverable.title,
      href: deliverable.href,
      hint: deliverable.updatedAt,
    })),
    ...scopeActions,
  ];
}
