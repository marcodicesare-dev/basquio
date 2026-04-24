import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { UIMessage } from "ai";

import { WorkspaceChat } from "@/components/workspace-chat/Chat";
import { resolveWorkspaceLocale } from "@/i18n";
import { getConversation } from "@/lib/workspace/conversations";
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
  const headersList = await headers();
  const locale = resolveWorkspaceLocale(headersList.get("accept-language"));
  if (!isUuid(id)) notFound();

  const workspace = await getCurrentWorkspace();
  const convo = await getConversation(id);
  if (!convo || convo.workspace_id !== workspace.id) notFound();

  const initialMessages = (Array.isArray(convo.messages) ? convo.messages : []) as UIMessage[];

  return (
    <div className="wbeta-workspace-layout">
      <section className="wbeta-chat-pane" aria-label="Conversation">
        <WorkspaceChat
          conversationId={convo.id}
          initialMessages={initialMessages}
          scopeId={convo.workspace_scope_id ?? undefined}
          locale={locale}
        />
      </section>
    </div>
  );
}
