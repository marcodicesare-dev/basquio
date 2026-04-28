import "server-only";

import type { WorkspaceCommandAction } from "@/components/workspace-command-palette";
import type { ScopeTree } from "@/lib/workspace/scopes";

export type RecentChatForCommand = {
  id: string;
  title: string;
  scopeName: string | null;
};

/**
 * Build the workspace-wide command palette action list. Mounted in
 * the workspace layout so every route has the same Cmd+K surface
 * (Linear / Notion / Cursor pattern). Actions land in four groups:
 *
 *   1. Open  -> Home, Memory, Sources, People (top-level nav)
 *   2. Recent chats -> last 6 conversations the user opened
 *   3. Clients -> every client scope the workspace knows
 *   4. Categories -> every category scope the workspace knows
 *
 * Functions scopes are intentionally omitted: the sidebar dropped the
 * group in round 1 because no user has asked for one yet.
 */
export function buildWorkspaceCommandActions({
  scopeTree,
  recentChats,
}: {
  scopeTree: ScopeTree;
  recentChats: RecentChatForCommand[];
}): WorkspaceCommandAction[] {
  const open: WorkspaceCommandAction[] = [
    {
      id: "open-home",
      group: "Open",
      label: "Home",
      href: "/workspace",
      hint: "Ask anything",
    },
    {
      id: "open-memory",
      group: "Open",
      label: "Memory",
      href: "/workspace/memory",
      hint: "Things, facts, rules",
    },
    {
      id: "open-sources",
      group: "Open",
      label: "Sources",
      href: "/workspace/sources",
      hint: "Files Basquio reads",
    },
    {
      id: "open-people",
      group: "Open",
      label: "People",
      href: "/workspace/people",
      hint: "Stakeholders and preferences",
    },
  ];

  const recents: WorkspaceCommandAction[] = recentChats.slice(0, 6).map((chat) => ({
    id: `chat-${chat.id}`,
    group: "Recent chat",
    label: chat.title,
    href: `/workspace/chat/${chat.id}`,
    hint: chat.scopeName ?? "Workspace",
  }));

  const clients: WorkspaceCommandAction[] = scopeTree.client.slice(0, 12).map((scope) => ({
    id: `client-${scope.id}`,
    group: "Client",
    label: scope.name,
    href: `/workspace/scope/client/${scope.slug}`,
  }));

  const categories: WorkspaceCommandAction[] = scopeTree.category.slice(0, 12).map((scope) => ({
    id: `category-${scope.id}`,
    group: "Category",
    label: scope.name,
    href: `/workspace/scope/category/${scope.slug}`,
  }));

  return [...open, ...recents, ...clients, ...categories];
}
