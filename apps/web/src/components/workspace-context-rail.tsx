"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import { compactSuggestionPrompt } from "@/lib/workspace/suggestion-display";
import type { WorkspaceSuggestion } from "@/lib/workspace/suggestions";

type EntityGroup = {
  type: string;
  label: string;
  count: number;
};

export type RecentConversation = {
  id: string;
  title: string;
  lastMessageAt: string;
  isCurrent?: boolean;
};

type ScopeRail = {
  id: string;
  name: string;
  kindLabel: string;
  caption: string;
};

type ScopeRailSummary = {
  rulesCount: number;
  factsCount: number;
  articlesCount: number;
  lastResearchLabel: string | null;
};

type ScopeRailStakeholder = {
  id: string;
  name: string;
  role: string | null;
};

type ScopeRailDeliverable = {
  id: string;
  title: string;
  updatedAt: string;
  href: string;
};

export type WorkspaceContextRailProps = {
  ariaLabel?: string;
  entityGroups?: EntityGroup[];
  recentConversations?: RecentConversation[];
  scope?: ScopeRail;
  scopeSummary?: ScopeRailSummary;
  stakeholders?: ScopeRailStakeholder[];
  deliverables?: ScopeRailDeliverable[];
  suggestions?: WorkspaceSuggestion[];
  memoryAside?: ReactNode;
};

function relativeTime(iso: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function WorkspaceContextRail({
  ariaLabel = "Workspace context",
  entityGroups = [],
  recentConversations = [],
  scope,
  scopeSummary,
  stakeholders = [],
  deliverables = [],
  suggestions = [],
  memoryAside,
}: WorkspaceContextRailProps) {
  if (
    entityGroups.length === 0 &&
    recentConversations.length === 0 &&
    !scope &&
    !scopeSummary &&
    stakeholders.length === 0 &&
    deliverables.length === 0 &&
    suggestions.length === 0 &&
    !memoryAside
  ) {
    return null;
  }

  return (
    <aside className="wbeta-rail" aria-label={ariaLabel}>
      {scope ? (
        <header className="wbeta-rail-head">
          <div>
            <p className="wbeta-rail-kicker">{scope.kindLabel}</p>
            <h2 className="wbeta-rail-title">{scope.name}</h2>
            <p className="wbeta-rail-scope-caption">{scope.caption}</p>
          </div>
        </header>
      ) : null}

      {scopeSummary ? (
        <ul className="wbeta-rail-stats" aria-label="Scope summary">
          <li>
            <span className="wbeta-rail-stat-num">
              {scopeSummary.rulesCount + scopeSummary.factsCount + scopeSummary.articlesCount}
            </span>
            <span className="wbeta-rail-stat-label">Context</span>
          </li>
          <li>
            <span className="wbeta-rail-stat-num">{stakeholders.length}</span>
            <span className="wbeta-rail-stat-label">People</span>
          </li>
          <li>
            <span className="wbeta-rail-stat-num">{deliverables.length}</span>
            <span className="wbeta-rail-stat-label">Chats</span>
          </li>
        </ul>
      ) : null}

      {scopeSummary?.lastResearchLabel ? (
        <p className="wbeta-rail-context-line">
          Last update: {scopeSummary.lastResearchLabel}
        </p>
      ) : null}

      {stakeholders.length > 0 ? (
        <section className="wbeta-rail-section">
          <header className="wbeta-rail-section-head">
            <h3 className="wbeta-rail-section-title">Stakeholders</h3>
            <Link className="wbeta-rail-more" href="/workspace/people">
              See all
            </Link>
          </header>
          <ul className="wbeta-rail-list">
            {stakeholders.slice(0, 4).map((person) => (
              <li key={person.id}>
                <Link href={`/workspace/people/${person.id}`} className="wbeta-rail-item">
                  <span className="wbeta-rail-item-title">{person.name}</span>
                  {person.role ? (
                    <span className="wbeta-rail-item-meta">{person.role}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {deliverables.length > 0 ? (
        <section className="wbeta-rail-section">
          <header className="wbeta-rail-section-head">
            <h3 className="wbeta-rail-section-title">Recent chats</h3>
            <span className="wbeta-rail-section-meta">{deliverables.length}</span>
          </header>
          <ul className="wbeta-rail-list">
            {deliverables.slice(0, 5).map((deliverable) => (
              <li key={deliverable.id}>
                <Link href={deliverable.href} className="wbeta-rail-item">
                  <span className="wbeta-rail-item-title">{deliverable.title}</span>
                  <span className="wbeta-rail-item-meta">{deliverable.updatedAt}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {suggestions.length > 0 ? (
        <section className="wbeta-rail-section">
          <header className="wbeta-rail-section-head">
            <h3 className="wbeta-rail-section-title">Try next</h3>
          </header>
          <ul className="wbeta-rail-list">
            {suggestions.slice(0, 3).map((suggestion) => (
              <li key={suggestion.id}>
                <button
                  type="button"
                  className="wbeta-rail-item wbeta-rail-suggestion"
                  onClick={() => sendPrompt(suggestion.prompt)}
                >
                  <span className="wbeta-rail-item-title">{compactSuggestionPrompt(suggestion.prompt)}</span>
                  <span className="wbeta-rail-item-meta">{suggestion.reason}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recentConversations.length > 0 ? (
        <section className="wbeta-rail-section">
          <header className="wbeta-rail-section-head">
            <h3 className="wbeta-rail-section-title">Recent chats</h3>
            <Link href="/workspace" className="wbeta-rail-new-chat" aria-label="New chat">
              New
            </Link>
          </header>
          <ul className="wbeta-rail-list">
            {recentConversations.slice(0, 8).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/workspace/chat/${c.id}`}
                  className={
                    c.isCurrent
                      ? "wbeta-rail-item wbeta-rail-item-active"
                      : "wbeta-rail-item"
                  }
                  aria-current={c.isCurrent ? "page" : undefined}
                >
                  <span className="wbeta-rail-item-title">{c.title}</span>
                  <span className="wbeta-rail-item-meta">{relativeTime(c.lastMessageAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {entityGroups.length > 0 ? (
        <section className="wbeta-rail-section">
          <header className="wbeta-rail-section-head">
            <h3 className="wbeta-rail-section-title">What Basquio knows</h3>
          </header>
          <ul className="wbeta-rail-chips">
            {entityGroups.map((group) => (
              <li key={group.type} className="wbeta-rail-chip">
                <span className="wbeta-rail-chip-label">{group.label}</span>
                <span className="wbeta-rail-chip-count">{group.count}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {memoryAside ? <div className="wbeta-rail-memory">{memoryAside}</div> : null}
    </aside>
  );
}

function sendPrompt(prompt: string) {
  window.dispatchEvent(
    new CustomEvent("basquio:workspace-prompt", {
      detail: { prompt },
    }),
  );
  document.getElementById("workspace-chat")?.scrollIntoView({
    block: "start",
    behavior: "smooth",
  });
}
