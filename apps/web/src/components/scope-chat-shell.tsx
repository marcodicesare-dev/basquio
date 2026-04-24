import type { ReactNode } from "react";

import { ScopeCommandPalette, type ScopeCommandAction } from "@/components/scope-command-palette";
import type { WorkspaceLocale } from "@/i18n";
import type { WorkspaceSuggestion } from "@/lib/workspace/suggestions";

export type ScopeStakeholder = {
  id: string;
  name: string;
  role: string | null;
  preferenceQuote: string | null;
};

export type ScopeDeliverable = {
  id: string;
  title: string;
  updatedAt: string;
  href: string;
};

export type WorkspaceKnowsSummary = {
  rulesCount: number;
  factsCount: number;
  articlesCount: number;
  lastResearchLabel: string | null;
};

export function ScopeChatShell({
  scope,
  stakeholders,
  workspaceKnows,
  deliverables,
  suggestions = [],
  chat,
  memoryAside,
  commandActions,
  locale = "en",
}: {
  scope: { id: string; name: string; kind: string };
  stakeholders: ScopeStakeholder[];
  workspaceKnows: WorkspaceKnowsSummary;
  deliverables: ScopeDeliverable[];
  suggestions?: WorkspaceSuggestion[];
  chat: ReactNode;
  memoryAside: ReactNode;
  commandActions: ScopeCommandAction[];
  locale?: WorkspaceLocale;
}) {
  void stakeholders;
  void workspaceKnows;
  void deliverables;
  void suggestions;
  void memoryAside;
  void locale;

  return (
    <div className="wbeta-workspace-layout wbeta-scope-chat-layout">
      <section className="wbeta-chat-pane wbeta-scope-chat-pane" aria-label={`Chat with ${scope.name}`}>
        <div className="wbeta-scope-chat-tools">
          <ScopeCommandPalette actions={commandActions} scopeName={scope.name} />
        </div>
        {chat}
      </section>
    </div>
  );
}

export function buildContextLine(scopeName: string, workspaceKnows: WorkspaceKnowsSummary): string {
  const research = workspaceKnows.lastResearchLabel
    ? ` Last updated ${workspaceKnows.lastResearchLabel}.`
    : "";
  return `Ask about ${scopeName}. I will use saved context and recent work.${research}`;
}
