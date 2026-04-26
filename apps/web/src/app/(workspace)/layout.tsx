import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { WorkspaceShell } from "@/components/workspace-shell";
import { resolveWorkspaceLocale } from "@/i18n";
import { buildSignInPath, getViewerState } from "@/lib/supabase/auth";
import { isTeamBetaEmail } from "@/lib/team-beta";
import { listConversations } from "@/lib/workspace/conversations";
import {
  countByScope,
  listScopesGrouped,
  type ScopeCounts,
  type WorkspaceScope,
} from "@/lib/workspace/scopes";

export const metadata = {
  title: "Workspace · Basquio",
};

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const headersList = await headers();
  const viewer = await getViewerState();

  if (!viewer.configured) {
    notFound();
  }

  if (!viewer.user) {
    const currentPath = headersList.get("x-next-url") ?? headersList.get("x-invoke-path") ?? "/workspace";
    redirect(buildSignInPath(currentPath));
  }

  if (!isTeamBetaEmail(viewer.user.email)) {
    notFound();
  }

  const [scopeTree, countsMap, recentConversations] = await Promise.all([
    listScopesGrouped().catch(() => ({ client: [], category: [], function: [], system: [] })),
    countByScope().catch(() => new Map<string, ScopeCounts>()),
    listConversations({ limit: 10 }).catch(() => []),
  ]);

  const scopeCounts: Record<string, ScopeCounts> = {};
  for (const [id, row] of countsMap) {
    scopeCounts[id] = row;
  }
  const scopeById = new Map(
    Object.values(scopeTree)
      .flat()
      .map((scope) => [scope.id, scope]),
  );

  return (
    <WorkspaceShell
      viewer={viewer}
      scopeTree={scopeTree}
      scopeCounts={scopeCounts}
      recentConversations={recentConversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title ?? "Untitled",
        lastMessageAt: conversation.last_message_at,
        scope: buildConversationScope(conversation.workspace_scope_id, scopeById),
      }))}
      locale={resolveWorkspaceLocale(headersList.get("accept-language"))}
    >
      {children}
    </WorkspaceShell>
  );
}

function buildConversationScope(scopeId: string | null, scopeById: Map<string, WorkspaceScope>) {
  if (!scopeId) return null;
  const scope = scopeById.get(scopeId);
  if (!scope) {
    return {
      name: "Unknown",
      kindLabel: "Context",
      tooltip: "This chat is tied to a context that is no longer available.",
    };
  }
  if (scope.kind === "system") {
    return {
      name: scope.name,
      kindLabel: "Workspace",
      tooltip: "This chat was opened in the full workspace context.",
    };
  }
  const kindLabel = singularScopeLabel(scope.kind);
  return {
    name: scope.name,
    kindLabel,
    tooltip: `Opened in ${kindLabel}: ${scope.name}. Basquio uses this context by default.`,
  };
}

function singularScopeLabel(kind: string): string {
  if (kind === "client") return "Client";
  if (kind === "category") return "Category";
  if (kind === "function") return "Function";
  return "Context";
}
