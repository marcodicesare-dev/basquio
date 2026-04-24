import Link from "next/link";
import { ArrowRight, Sparkle, UsersThree } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

import { WorkspaceSuggestionSurface } from "@/components/workspace-suggestions";
import { getWorkspaceCopy, type WorkspaceLocale } from "@/i18n";
import type { WorkspaceSuggestion } from "@/lib/workspace/suggestions";

/**
 * Scope landing layout per shell spec §4.3.1.
 *
 * The critical rearchitecture that addresses Rossella's "chat
 * wrapper" critique from Apr 22: workspace context comes FIRST,
 * chat comes LAST. Reading top to bottom, the analyst sees who is
 * in the scope, what rules apply, what Basquio has already learned,
 * and what the most recent deliverables were. The chat is one of
 * several actions, not the product.
 *
 * This component renders the context strip only. The parent page
 * slots the existing WorkspaceChat under it so the assistant thread
 * remains fully functional.
 *
 * Keeps the visual load explicit: ≤ 4 sections, never a 5th, because
 * the chat composer at the bottom is the next anchor. Hiding any
 * section that is empty avoids the "context theater" anti-pattern
 * where zeros masquerade as signal.
 */

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

export function ScopeLanding({
  scope,
  stakeholders,
  workspaceKnows,
  deliverables,
  suggestions = [],
  chat,
  locale = "en",
}: {
  scope: { id: string; name: string; kind: string };
  stakeholders: ScopeStakeholder[];
  workspaceKnows: WorkspaceKnowsSummary;
  deliverables: ScopeDeliverable[];
  suggestions?: WorkspaceSuggestion[];
  chat: ReactNode;
  locale?: WorkspaceLocale;
}) {
  const copy = getWorkspaceCopy(locale).scope;
  const stakeholderCount = stakeholders.length;
  const deliverableCount = deliverables.length;
  const kindLabel =
    scope.kind === "client"
      ? copy.client
      : scope.kind === "category"
        ? copy.category
        : scope.kind === "function"
          ? copy.function
          : scope.kind.charAt(0).toUpperCase() + scope.kind.slice(1);

  return (
    <div className="wbeta-scope-landing">
      <header className="wbeta-scope-landing-head">
        <h1 className="wbeta-scope-landing-title">{scope.name}</h1>
        <p className="wbeta-scope-landing-caption">
          {kindLabel}
          {stakeholderCount > 0 ? ` · ${stakeholderCount} stakeholders` : ""}
          {deliverableCount > 0 ? ` · ${deliverableCount} deliverables` : ""}
        </p>
      </header>

      {stakeholders.length > 0 ? (
        <section className="wbeta-scope-landing-section" aria-labelledby="stakeholders-h">
          <header className="wbeta-scope-landing-section-head">
            <h2 id="stakeholders-h" className="wbeta-scope-landing-section-title">
              {copy.stakeholders}
            </h2>
            <Link
              className="wbeta-scope-landing-see-all"
              href={`/workspace/people?scope=${scope.id}`}
            >
              {copy.seeAll} ({stakeholderCount})
              <ArrowRight size={12} weight="regular" />
            </Link>
          </header>
          <ul className="wbeta-scope-landing-stakeholders">
            {stakeholders.slice(0, 4).map((s) => (
              <li key={s.id} className="wbeta-scope-landing-stakeholder-card">
                <Link
                  href={`/workspace/people/${s.id}`}
                  className="wbeta-scope-landing-stakeholder-link"
                >
                  <span className="wbeta-scope-landing-stakeholder-name">{s.name}</span>
                  {s.role ? (
                    <span className="wbeta-scope-landing-stakeholder-role">{s.role}</span>
                  ) : null}
                  {s.preferenceQuote ? (
                    <span className="wbeta-scope-landing-stakeholder-pref">
                      &ldquo;{s.preferenceQuote}&rdquo;
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="wbeta-scope-landing-section" aria-labelledby="knows-h">
        <header className="wbeta-scope-landing-section-head">
          <h2 id="knows-h" className="wbeta-scope-landing-section-title">
            {copy.workspaceKnows}
          </h2>
          <Sparkle size={14} weight="regular" />
        </header>
        <ul className="wbeta-scope-landing-knows">
          <li>
            <Link href="/workspace/memory" className="wbeta-scope-landing-knows-row">
              <span className="wbeta-scope-landing-knows-count">
                {workspaceKnows.rulesCount}
              </span>
              <span>
                {workspaceKnows.rulesCount === 1 ? copy.ruleApplies : copy.rulesApply}
              </span>
            </Link>
          </li>
          <li>
            <span className="wbeta-scope-landing-knows-row wbeta-scope-landing-knows-row-static">
              <span className="wbeta-scope-landing-knows-count">
                {workspaceKnows.factsCount}
              </span>
              <span>
                {workspaceKnows.factsCount === 1 ? copy.factAbout : copy.factsAbout} {scope.name}
              </span>
            </span>
          </li>
          <li>
            <span className="wbeta-scope-landing-knows-row wbeta-scope-landing-knows-row-static">
              <span className="wbeta-scope-landing-knows-count">
                {workspaceKnows.articlesCount}
              </span>
              <span>
                {workspaceKnows.articlesCount === 1 ? copy.articleInGraph : copy.articlesInGraph}
              </span>
            </span>
          </li>
          {workspaceKnows.lastResearchLabel ? (
            <li>
              <span className="wbeta-scope-landing-knows-row wbeta-scope-landing-knows-row-static">
                <span className="wbeta-scope-landing-knows-count">
                  <Sparkle size={12} weight="fill" />
                </span>
                <span>{copy.lastResearch}: {workspaceKnows.lastResearchLabel}</span>
              </span>
            </li>
          ) : null}
        </ul>
        {stakeholders.length === 0 ? (
          <p className="wbeta-scope-landing-empty-hint">
            <UsersThree size={14} weight="regular" aria-hidden />
            {copy.stakeholderHint}
          </p>
        ) : null}
      </section>

      <WorkspaceSuggestionSurface
        title={copy.suggestedNext}
        countLabel={suggestions.length > 0 ? `${Math.min(suggestions.length, 3)} ready` : undefined}
        placement="scope"
        suggestions={suggestions}
      />

      {deliverables.length > 0 ? (
        <section className="wbeta-scope-landing-section" aria-labelledby="deliverables-h">
          <header className="wbeta-scope-landing-section-head">
            <h2 id="deliverables-h" className="wbeta-scope-landing-section-title">
              {copy.recentDeliverables}
            </h2>
            <Link
              className="wbeta-scope-landing-see-all"
              href={`/workspace/memory?scope=${scope.id}`}
            >
              {copy.seeAll} ({deliverableCount})
              <ArrowRight size={12} weight="regular" />
            </Link>
          </header>
          <ul className="wbeta-scope-landing-deliverables">
            {deliverables.slice(0, 5).map((d) => (
              <li key={d.id} className="wbeta-scope-landing-deliverable-row">
                <Link href={d.href} className="wbeta-scope-landing-deliverable-link">
                  <span className="wbeta-scope-landing-deliverable-title">{d.title}</span>
                  <span className="wbeta-scope-landing-deliverable-meta">{d.updatedAt}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="wbeta-scope-landing-chat" role="region" aria-label={copy.chatComposer}>
        {chat}
      </div>
    </div>
  );
}
