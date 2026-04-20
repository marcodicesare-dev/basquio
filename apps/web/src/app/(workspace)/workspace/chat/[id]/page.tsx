import { notFound } from "next/navigation";
import type { UIMessage } from "ai";

import { WorkspaceChat } from "@/components/workspace-chat/Chat";
import { WorkspaceContextRail } from "@/components/workspace-context-rail";
import { getConversation, listConversations } from "@/lib/workspace/conversations";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const dynamic = "force-dynamic";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return { title: "Chat · Basquio" };
  const convo = await getConversation(id).catch(() => null);
  return { title: convo?.title ? `${convo.title} · Basquio` : "Chat · Basquio" };
}

export default async function WorkspaceChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const workspace = await getCurrentWorkspace();
  const convo = await getConversation(id);
  if (!convo || convo.workspace_id !== workspace.id) notFound();

  const initialMessages = (Array.isArray(convo.messages) ? convo.messages : []) as UIMessage[];

  const recentConversations = await listConversations({
    workspaceId: workspace.id,
    limit: 15,
  }).catch(() => []);

  return (
    <div className="wbeta-workspace-layout">
      <section className="wbeta-chat-pane" aria-label="Conversation">
        <WorkspaceChat
          conversationId={convo.id}
          initialMessages={initialMessages}
          scopeId={convo.workspace_scope_id ?? undefined}
        />
      </section>

      <WorkspaceContextRail
        entityGroups={[]}
        recentConversations={recentConversations.map((c) => ({
          id: c.id,
          title: c.title ?? "Untitled",
          lastMessageAt: c.last_message_at,
          isCurrent: c.id === convo.id,
        }))}
      />
    </div>
  );
}
