import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

import { ScopeCommandPalette, type ScopeCommandAction } from "@/components/scope-command-palette";
import { WorkspaceContextRail } from "@/components/workspace-context-rail";
import { getWorkspaceCopy, type WorkspaceLocale } from "@/i18n";
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
  const copy = getWorkspaceCopy(locale).scope;
  const kindLabel = getKindLabel(scope.kind, copy);
  const caption = buildCaption({
    kindLabel,
    stakeholderCount: stakeholders.length,
    deliverableCount: deliverables.length,
  });
  const contextLine = buildContextLine(scope.name, workspaceKnows);

  return (
    <div className="wbeta-workspace-layout wbeta-scope-chat-layout">
      <details className="wbeta-scope-mobile-context">
        <summary>
          <span>{scope.name}</span>
          <small>
            Saved context · {deliverables.length} recent chat{deliverables.length === 1 ? "" : "s"}
          </small>
        </summary>
        <div className="wbeta-scope-mobile-context-body">
          <WorkspaceContextRail
            ariaLabel="Mobile scope context"
            scope={{ id: scope.id, name: scope.name, kindLabel, caption }}
            scopeSummary={workspaceKnows}
            stakeholders={stakeholders}
            deliverables={deliverables}
            suggestions={suggestions}
            memoryAside={memoryAside}
          />
        </div>
      </details>

      <section className="wbeta-chat-pane wbeta-scope-chat-pane" aria-label={`Chat with ${scope.name}`}>
        <header className="wbeta-scope-chat-head">
          <div>
            <p className="wbeta-scope-chat-kicker">{kindLabel}</p>
            <h1>{scope.name}</h1>
            <p>{contextLine}</p>
          </div>
          <ScopeCommandPalette actions={commandActions} scopeName={scope.name} />
        </header>
        {chat}
      </section>

      <WorkspaceContextRail
        scope={{ id: scope.id, name: scope.name, kindLabel, caption }}
        scopeSummary={workspaceKnows}
        stakeholders={stakeholders}
        deliverables={deliverables}
        suggestions={suggestions}
        memoryAside={memoryAside}
      />

      <Link href="#workspace-chat" className="wbeta-scope-chat-skip">
        Jump to composer
        <ArrowRight size={12} weight="bold" />
      </Link>
    </div>
  );
}

function getKindLabel(
  kind: string,
  copy: ReturnType<typeof getWorkspaceCopy>["scope"],
): string {
  if (kind === "client") return copy.client;
  if (kind === "category") return copy.category;
  if (kind === "function") return copy.function;
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function buildCaption({
  kindLabel,
  stakeholderCount,
  deliverableCount,
}: {
  kindLabel: string;
  stakeholderCount: number;
  deliverableCount: number;
}): string {
  const parts = [kindLabel];
  if (stakeholderCount > 0) {
    parts.push(`${stakeholderCount} stakeholder${stakeholderCount === 1 ? "" : "s"}`);
  }
  if (deliverableCount > 0) {
    parts.push(`${deliverableCount} chat${deliverableCount === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

export function buildContextLine(scopeName: string, workspaceKnows: WorkspaceKnowsSummary): string {
  const research = workspaceKnows.lastResearchLabel
    ? ` Last updated ${workspaceKnows.lastResearchLabel}.`
    : "";
  return `Ask about ${scopeName}. I will use saved context and recent work.${research}`;
}
