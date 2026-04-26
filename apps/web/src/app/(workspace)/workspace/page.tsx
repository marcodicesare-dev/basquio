import { headers } from "next/headers";

import { getViewerState } from "@/lib/supabase/auth";
import { WorkspaceHomeDashboard } from "@/components/workspace-home-dashboard";
import {
  getWorkspaceHomeActivity,
  listRecentWorkspaceDeliverables,
  listRecentWorkspaceDocuments,
  listWorkspaceEntitiesGrouped,
} from "@/lib/workspace/db";
import { WorkspaceChat } from "@/components/workspace-chat/Chat";
import { WorkspaceShortcuts } from "@/components/workspace-shortcuts";
import { resolveWorkspaceLocale } from "@/i18n";
import { listConversations } from "@/lib/workspace/conversations";
import { listMemoryEntries } from "@/lib/workspace/memory";
import { countByScope, listScopes } from "@/lib/workspace/scopes";
import { buildSuggestions } from "@/lib/workspace/suggestions";
import type { ScopeCounts } from "@/lib/workspace/types";
import { getCurrentWorkspace, isWorkspaceOnboarded } from "@/lib/workspace/workspaces";

export const metadata = {
  title: "Workspace · Basquio",
};

export const dynamic = "force-dynamic";

async function safe<T>(promise: Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    console.error(`[workspace] ${label} failed`, error);
    return fallback;
  }
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  person: "People",
  organization: "Organizations",
  brand: "Brands",
  category: "Categories",
  retailer: "Retailers",
  metric: "Metrics",
  sub_category: "Sub-categories",
  sku: "Products",
  meeting: "Meetings",
  email: "Emails",
  deliverable: "Deliverables",
  question: "Questions",
  document: "Documents",
};

export default async function WorkspaceHomePage() {
  const headersList = await headers();
  const [viewer, workspace, documents, entitiesByType, deliverables, conversations, memory, scopes, countsMap, suggestions, activity] = await Promise.all([
    getViewerState(),
    getCurrentWorkspace(),
    safe(listRecentWorkspaceDocuments(50), [], "list documents"),
    safe(listWorkspaceEntitiesGrouped(), {}, "list entities"),
    safe(listRecentWorkspaceDeliverables(25), [], "list deliverables"),
    safe(listConversations({ limit: 15 }), [], "list conversations"),
    safe(listMemoryEntries({ limit: 200 }), [], "list memory"),
    safe(listScopes(), [], "list scopes"),
    safe(countByScope(), new Map<string, ScopeCounts>(), "count scopes"),
    safe(buildSuggestions(3), [], "build suggestions"),
    safe(
      getWorkspaceHomeActivity(7),
      {
        recentDocumentCount: 0,
        recentMemoryCount: 0,
        recentFactCount: 0,
        recentDeliverableCount: 0,
        firstActivityAt: null,
      },
      "load activity",
    ),
  ]);

  const totalEntityCount = Object.values(entitiesByType).reduce(
    (sum, group) => sum + group.length,
    0,
  );
  const isEmpty =
    scopes.length === 0 &&
    documents.length === 0 &&
    deliverables.length === 0 &&
    memory.length === 0 &&
    totalEntityCount === 0;
  const onboarded = isWorkspaceOnboarded(workspace);

  const entityGroups = Object.entries(entitiesByType)
    .filter(([, rows]) => rows.length > 0)
    .map(([type, rows]) => ({
      type,
      label: ENTITY_TYPE_LABELS[type] ?? type,
      count: rows.length,
    }))
    .sort((a, b) => b.count - a.count);

  const recentConversations = conversations.map((c) => ({
    id: c.id,
    title: c.title ?? "Untitled",
    lastMessageLabel: formatRelative(c.last_message_at),
    href: `/workspace/chat/${c.id}`,
  }));

  const activeScopes = scopes
    .filter((scope) => scope.kind !== "system")
    .map((scope) => {
      const counts = countsMap.get(scope.id) ?? {
        scope_id: scope.id,
        memory_count: 0,
        deliverable_count: 0,
        fact_count: 0,
        last_activity_at: null,
      };
      const lastActivityAt = counts.last_activity_at ?? scope.created_at;
      return {
        id: scope.id,
        name: scope.name,
        kind: scope.kind,
        href: `/workspace/scope/${scope.kind}/${scope.slug}`,
        memoryCount: counts.memory_count,
        factCount: counts.fact_count,
        deliverableCount: counts.deliverable_count,
        lastActivityAt,
        lastActivityLabel: formatRelative(lastActivityAt),
        total: counts.memory_count + counts.fact_count + counts.deliverable_count,
      };
    })
    .sort(
      (a, b) =>
        new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime() ||
        b.total - a.total ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 6);

  const firstActivityAgeDays = activity.firstActivityAt
    ? (Date.now() - new Date(activity.firstActivityAt).getTime()) / (24 * 60 * 60 * 1000)
    : 0;
  const weeklyLearnedCount =
    activity.recentDocumentCount + activity.recentMemoryCount + activity.recentFactCount;
  const homeSuggestions =
    suggestions.length > 0
      ? suggestions
      : [
          {
            id: "fallback-ask",
            kind: "investigate" as const,
            prompt: "Ask what changed across my clients this week.",
            reason: "Uses recent workspace chats, saved knowledge, and searchable documents.",
          },
        ];
  const state =
    !onboarded && isEmpty
      ? "brand-new"
      : isEmpty || memory.length < 3 || documents.length === 0
        ? "sparse"
        : "populated";
  const userName = formatUserName(viewer.user?.email ?? "");
  const locale = resolveWorkspaceLocale(headersList.get("accept-language"));

  return (
    <>
      <WorkspaceShortcuts />
      <WorkspaceHomeDashboard
        greeting={buildGreeting(userName, locale)}
        learnedCount={weeklyLearnedCount}
        state={state}
        activeScopes={activeScopes}
        conversations={recentConversations}
        entityGroups={entityGroups}
        weeklyStats={{
          deliverables: activity.recentDeliverableCount,
          facts: activity.recentFactCount,
          documents: activity.recentDocumentCount,
          memories: activity.recentMemoryCount,
          estimatedHoursSaved: Math.max(
            1,
            activity.recentDeliverableCount * 2 + activity.recentDocumentCount,
          ),
          visible: firstActivityAgeDays >= 7,
        }}
        chat={
          <WorkspaceChat
            locale={locale}
            promptSuggestions={homeSuggestions}
            compactEmpty
            contextGreeting="Ask across clients, knowledge, and recent work."
          />
        }
        locale={locale}
      />
    </>
  );
}

function buildGreeting(name: string, locale: "en" | "it"): string {
  const hour = new Date().getHours();
  if (locale === "it") {
    const base = hour < 12 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera";
    return `${base}, ${name}`;
  }
  const base = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${base}, ${name}`;
}

function formatUserName(email: string): string {
  const local = email.split("@")[0] ?? "";
  const first = local.split(/[._-]/)[0] ?? "there";
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "there";
}

function formatRelative(iso: string): string {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return `${Math.floor(diffSec / 86400)}d`;
}
