import Link from "next/link";
import {
  ArrowRight,
  ChatText,
  FileText,
  Folders,
  Lightbulb,
} from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

import { getWorkspaceCopy, type WorkspaceLocale } from "@/i18n";

export type WorkspaceHomeScope = {
  id: string;
  name: string;
  kind: string;
  href: string;
  memoryCount: number;
  factCount: number;
  deliverableCount: number;
  lastActivityLabel?: string;
};

export type WorkspaceHomeConversation = {
  id: string;
  title: string;
  lastMessageLabel: string;
  href: string;
};

export type WorkspaceHomeEntityGroup = {
  label: string;
  count: number;
};

export type WorkspaceHomeWeeklyStats = {
  deliverables: number;
  facts: number;
  documents: number;
  memories: number;
  estimatedHoursSaved: number;
  visible: boolean;
};

export type WorkspaceHomeState = "brand-new" | "sparse" | "populated";

export function WorkspaceHomeDashboard({
  greeting,
  learnedCount,
  state,
  activeScopes,
  conversations,
  entityGroups,
  weeklyStats,
  chat,
  setup,
  locale = "en",
}: {
  greeting: string;
  learnedCount: number;
  state: WorkspaceHomeState;
  activeScopes: WorkspaceHomeScope[];
  conversations: WorkspaceHomeConversation[];
  entityGroups: WorkspaceHomeEntityGroup[];
  weeklyStats: WorkspaceHomeWeeklyStats;
  chat: ReactNode;
  setup?: ReactNode;
  locale?: WorkspaceLocale;
}) {
  const copy = getWorkspaceCopy(locale).home;
  if (state === "brand-new") {
    return (
      <div className="wbeta-home wbeta-home-empty-wrap">
        <section className="wbeta-home-empty-card" aria-labelledby="workspace-empty-title">
          <p className="wbeta-home-eyebrow">{copy.eyebrow}</p>
          <h1 id="workspace-empty-title">{copy.welcomeTitle}</h1>
          <p>{copy.welcomeBody}</p>
          <Link className="wbeta-home-primary" href="/onboarding/1">
            <span>{copy.setupWorkspace}</span>
            <ArrowRight size={14} weight="bold" />
          </Link>
        </section>
        {setup ? (
          <section id="workspace-setup" className="wbeta-home-setup">
            {setup}
          </section>
        ) : null}
      </div>
    );
  }

  const visibleScopes = activeScopes.slice(0, 3);

  return (
    <div className="wbeta-home">
      <header className="wbeta-home-hero">
        <div>
          <p className="wbeta-home-eyebrow">{copy.eyebrow}</p>
          <h1>{greeting}</h1>
          <p className="wbeta-home-learned">
            {learnedCount > 0 ? (
              <>
                {copy.learnedPrefix} <strong>{learnedCount}</strong> {copy.learnedSuffix}
              </>
            ) : (
              copy.readyToLearn
            )}
          </p>
        </div>
      </header>

      <section id="workspace-chat" className="wbeta-home-chat wbeta-home-chat-primary" aria-label="Workspace chat">
        {chat}
      </section>

      {state === "sparse" ? <SparseWorkspacePanel copy={copy} /> : null}

      <div className="wbeta-home-two-col">
        <section className="wbeta-home-section" aria-labelledby="recent-chats-home">
          <div className="wbeta-home-section-head">
            <h2 id="recent-chats-home">{copy.recentChats}</h2>
            <Link href="/workspace">{copy.newChat}</Link>
          </div>
          {conversations.length > 0 ? (
            <ul className="wbeta-home-list">
              {conversations.slice(0, 5).map((conversation) => (
                <li key={conversation.id}>
                  <Link href={conversation.href}>
                    <span>{conversation.title}</span>
                    <time>{conversation.lastMessageLabel}</time>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wbeta-home-empty-line">
              Ask Basquio a question and the thread will stay here.
            </p>
          )}
        </section>

        <section className="wbeta-home-section" aria-labelledby="memory-visible-home">
          <div className="wbeta-home-section-head">
            <h2 id="memory-visible-home">{copy.whatBasquioKnows}</h2>
            <Link href="/workspace/memory">{copy.openMemory}</Link>
          </div>
          {entityGroups.length > 0 ? (
            <ul className="wbeta-home-chip-list">
              {entityGroups.slice(0, 8).map((group) => (
                <li key={group.label}>
                  <span>{group.label}</span>
                  <strong>{group.count}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wbeta-home-empty-line">
              Memory grows as you upload files, save rules, and ask scoped questions.
            </p>
          )}
        </section>
      </div>

      <section className="wbeta-home-section" aria-labelledby="active-scopes">
        <div className="wbeta-home-section-head">
          <h2 id="active-scopes">{copy.activeScopes}</h2>
          <span>{visibleScopes.length > 0 ? `${copy.top} ${visibleScopes.length}` : copy.noScopes}</span>
        </div>
        {visibleScopes.length > 0 ? (
          <div className="wbeta-home-scope-grid">
            {visibleScopes.map((scope) => (
              <Link key={scope.id} href={scope.href} className="wbeta-home-scope-card">
                <span className="wbeta-home-scope-kind">{scope.kind}</span>
                <strong>{scope.name}</strong>
                {scope.lastActivityLabel ? (
                  <span className="wbeta-home-scope-updated">
                    {copy.updated} {scope.lastActivityLabel}
                  </span>
                ) : null}
                <dl>
                  <div>
                    <dt>Memory</dt>
                    <dd>{scope.memoryCount}</dd>
                  </div>
                  <div>
                    <dt>Facts</dt>
                    <dd>{scope.factCount}</dd>
                  </div>
                  <div>
                    <dt>Deliverables</dt>
                    <dd>{scope.deliverableCount}</dd>
                  </div>
                </dl>
              </Link>
            ))}
          </div>
        ) : (
          <p className="wbeta-home-empty-line">
            Add a client, category, or function in the sidebar to create your first scope.
          </p>
        )}
      </section>

      <section className="wbeta-home-section" aria-labelledby="this-week-home">
        <div className="wbeta-home-section-head">
          <h2 id="this-week-home">{copy.thisWeek}</h2>
          <span>{weeklyStats.visible ? copy.current : copy.buildingBaseline}</span>
        </div>
        {weeklyStats.visible ? (
          <ul className="wbeta-home-stat-list">
            <li>
              <FileText size={15} weight="regular" />
              <span>{weeklyStats.deliverables} {copy.deliverablesShipped}</span>
            </li>
            <li>
              <Lightbulb size={15} weight="regular" />
              <span>{weeklyStats.facts} {copy.stakeholderFactsUpdated}</span>
            </li>
            <li>
              <Folders size={15} weight="regular" />
              <span>{weeklyStats.documents} {copy.documentsAdded}</span>
            </li>
            <li>
              <ChatText size={15} weight="regular" />
              <span>{weeklyStats.estimatedHoursSaved} {copy.hoursSaved}</span>
            </li>
          </ul>
        ) : (
          <p className="wbeta-home-empty-line">{copy.statsBaseline}</p>
        )}
      </section>

    </div>
  );
}

function SparseWorkspacePanel({ copy }: { copy: ReturnType<typeof getWorkspaceCopy>["home"] }) {
  return (
    <section className="wbeta-home-sparse" aria-labelledby="sparse-workspace-title">
      <div>
        <p className="wbeta-home-eyebrow">{copy.missingContext}</p>
        <h2 id="sparse-workspace-title">{copy.sparseTitle}</h2>
      </div>
      <div className="wbeta-home-sparse-grid">
        <Link href="/workspace/people">
          <strong>{copy.addStakeholder}</strong>
          <span>{copy.addStakeholderBody}</span>
        </Link>
        <a href="#workspace-chat">
          <strong>{copy.uploadBrief}</strong>
          <span>{copy.uploadBriefBody}</span>
        </a>
        <Link href="/workspace/memory">
          <strong>{copy.teachRule}</strong>
          <span>{copy.teachRuleBody}</span>
        </Link>
      </div>
    </section>
  );
}
