import Link from "next/link";
import {
  ArrowRight,
  ChatText,
  FileText,
  Folders,
  Lightbulb,
} from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

import { WorkspaceHomePromptAction } from "@/components/workspace-home-prompt-action";

export type WorkspaceHomeSuggestion = {
  id: string;
  kind: "summarize" | "investigate" | "narrate" | "retry";
  prompt: string;
  reason: string;
};

export type WorkspaceHomeScope = {
  id: string;
  name: string;
  kind: string;
  href: string;
  memoryCount: number;
  factCount: number;
  deliverableCount: number;
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

const KIND_LABELS: Record<WorkspaceHomeSuggestion["kind"], string> = {
  summarize: "Summarize",
  investigate: "Investigate",
  narrate: "Narrate",
  retry: "Retry",
};

export function WorkspaceHomeDashboard({
  greeting,
  learnedCount,
  state,
  suggestions,
  activeScopes,
  conversations,
  entityGroups,
  weeklyStats,
  chat,
  setup,
}: {
  greeting: string;
  learnedCount: number;
  state: WorkspaceHomeState;
  suggestions: WorkspaceHomeSuggestion[];
  activeScopes: WorkspaceHomeScope[];
  conversations: WorkspaceHomeConversation[];
  entityGroups: WorkspaceHomeEntityGroup[];
  weeklyStats: WorkspaceHomeWeeklyStats;
  chat: ReactNode;
  setup?: ReactNode;
}) {
  if (state === "brand-new") {
    return (
      <div className="wbeta-home wbeta-home-empty-wrap">
        <section className="wbeta-home-empty-card" aria-labelledby="workspace-empty-title">
          <p className="wbeta-home-eyebrow">Workspace home</p>
          <h1 id="workspace-empty-title">Welcome to Basquio</h1>
          <p>
            Your workspace will remember your clients, your stakeholders, and your style.
            Every answer cites where it came from.
          </p>
          <a className="wbeta-home-primary" href="#workspace-setup">
            <span>Set up workspace</span>
            <ArrowRight size={14} weight="bold" />
          </a>
        </section>
        {setup ? (
          <section id="workspace-setup" className="wbeta-home-setup">
            {setup}
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="wbeta-home">
      <header className="wbeta-home-hero">
        <div>
          <p className="wbeta-home-eyebrow">Workspace home</p>
          <h1>{greeting}</h1>
          <p className="wbeta-home-learned">
            {learnedCount > 0 ? (
              <>
                This week, Basquio learned <strong>{learnedCount}</strong> new things about your
                clients.
              </>
            ) : (
              "Basquio is ready to learn from your next file, rule, or chat."
            )}
          </p>
        </div>
        <Link className="wbeta-home-primary" href="#workspace-chat">
          <ChatText size={15} weight="bold" />
          <span>Ask across workspace</span>
        </Link>
      </header>

      {state === "sparse" ? <SparseWorkspacePanel /> : null}

      <section className="wbeta-home-section" aria-labelledby="suggested-today">
        <div className="wbeta-home-section-head">
          <h2 id="suggested-today">Suggested for today</h2>
          <span>{suggestions.length} ready</span>
        </div>
        {suggestions.length > 0 ? (
          <div className="wbeta-home-suggestion-grid">
            {suggestions.slice(0, 3).map((suggestion) => (
              <article key={suggestion.id} className="wbeta-home-suggestion">
                <span className="wbeta-home-suggestion-kind">{KIND_LABELS[suggestion.kind]}</span>
                <h3>{suggestion.prompt}</h3>
                <p>{suggestion.reason}</p>
                <WorkspaceHomePromptAction prompt={suggestion.prompt} />
              </article>
            ))}
          </div>
        ) : (
          <p className="wbeta-home-empty-line">
            Suggestions appear after Basquio sees a file, a memory, or a recent chat.
          </p>
        )}
      </section>

      <section className="wbeta-home-section" aria-labelledby="active-scopes">
        <div className="wbeta-home-section-head">
          <h2 id="active-scopes">Active scopes</h2>
          <span>{activeScopes.length > 0 ? `Top ${activeScopes.length}` : "No scopes yet"}</span>
        </div>
        {activeScopes.length > 0 ? (
          <div className="wbeta-home-scope-grid">
            {activeScopes.map((scope) => (
              <Link key={scope.id} href={scope.href} className="wbeta-home-scope-card">
                <span className="wbeta-home-scope-kind">{scope.kind}</span>
                <strong>{scope.name}</strong>
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

      <div className="wbeta-home-two-col">
        <section className="wbeta-home-section" aria-labelledby="recent-chats-home">
          <div className="wbeta-home-section-head">
            <h2 id="recent-chats-home">Recent chats</h2>
            <Link href="/workspace">New chat</Link>
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
            <h2 id="memory-visible-home">What Basquio knows</h2>
            <Link href="/workspace/memory">Open memory</Link>
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

      <section className="wbeta-home-section" aria-labelledby="this-week-home">
        <div className="wbeta-home-section-head">
          <h2 id="this-week-home">This week</h2>
          <span>{weeklyStats.visible ? "Current" : "Building baseline"}</span>
        </div>
        {weeklyStats.visible ? (
          <ul className="wbeta-home-stat-list">
            <li>
              <FileText size={15} weight="regular" />
              <span>{weeklyStats.deliverables} deliverables shipped</span>
            </li>
            <li>
              <Lightbulb size={15} weight="regular" />
              <span>{weeklyStats.facts} stakeholder facts updated</span>
            </li>
            <li>
              <Folders size={15} weight="regular" />
              <span>{weeklyStats.documents} documents added to memory</span>
            </li>
            <li>
              <ChatText size={15} weight="regular" />
              <span>{weeklyStats.estimatedHoursSaved} hours saved, estimated</span>
            </li>
          </ul>
        ) : (
          <p className="wbeta-home-empty-line">Stats appear after a week of activity.</p>
        )}
      </section>

      <section id="workspace-chat" className="wbeta-home-chat" aria-label="Workspace chat">
        {chat}
      </section>
    </div>
  );
}

function SparseWorkspacePanel() {
  return (
    <section className="wbeta-home-sparse" aria-labelledby="sparse-workspace-title">
      <div>
        <p className="wbeta-home-eyebrow">Missing context</p>
        <h2 id="sparse-workspace-title">Add the pieces that make answers feel yours.</h2>
      </div>
      <div className="wbeta-home-sparse-grid">
        <Link href="/workspace/people">
          <strong>Add a stakeholder</strong>
          <span>Tell Basquio who reads the work and what they care about.</span>
        </Link>
        <a href="#workspace-chat">
          <strong>Upload one brief</strong>
          <span>Drop an old deck, export, transcript, or category note into chat.</span>
        </a>
        <Link href="/workspace/memory">
          <strong>Teach one rule</strong>
          <span>Save the KPI, tone, or citation convention Basquio should never forget.</span>
        </Link>
      </div>
    </section>
  );
}
