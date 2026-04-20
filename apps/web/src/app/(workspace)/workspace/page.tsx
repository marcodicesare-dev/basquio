import { getViewerState } from "@/lib/supabase/auth";
import {
  countProcessingDocuments,
  listRecentWorkspaceDeliverables,
  listRecentWorkspaceDocuments,
  listWorkspaceEntitiesGrouped,
} from "@/lib/workspace/db";
import { WorkspaceAutoRefresh } from "@/components/workspace-auto-refresh";
import { WorkspaceChat } from "@/components/workspace-chat/Chat";
import { WorkspaceContextRail } from "@/components/workspace-context-rail";
import { WorkspaceShortcuts } from "@/components/workspace-shortcuts";
import { WorkspaceOnboarding } from "@/components/workspace-onboarding";
import { listConversations } from "@/lib/workspace/conversations";
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
  const [workspace, documents, entitiesByType, deliverables, conversations] = await Promise.all([
    getCurrentWorkspace(),
    safe(listRecentWorkspaceDocuments(20), [], "list documents"),
    safe(listWorkspaceEntitiesGrouped(), {}, "list entities"),
    safe(listRecentWorkspaceDeliverables(8), [], "list deliverables"),
    safe(listConversations({ limit: 15 }), [], "list conversations"),
  ]);

  const processingCount = countProcessingDocuments(documents);
  const totalEntityCount = Object.values(entitiesByType).reduce(
    (sum, group) => sum + group.length,
    0,
  );
  const isEmpty = documents.length === 0 && deliverables.length === 0 && totalEntityCount === 0;
  const onboarded = isWorkspaceOnboarded(workspace);

  if (!onboarded && isEmpty) {
    return (
      <div className="wbeta-page wbeta-page-onboard">
        <WorkspaceOnboarding />
      </div>
    );
  }

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
    lastMessageAt: c.last_message_at,
  }));

  return (
    <div className="wbeta-workspace-layout">
      <WorkspaceAutoRefresh processingCount={processingCount} />
      <WorkspaceShortcuts />

      <section className="wbeta-chat-pane" aria-label="Workspace conversation">
        <WorkspaceChat />
      </section>

      <WorkspaceContextRail
        entityGroups={entityGroups}
        recentConversations={recentConversations}
      />
    </div>
  );
}
