import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
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
  state,
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

  return (
    <div className="wbeta-home wbeta-home-chat-only">
      <section id="workspace-chat" className="wbeta-home-chat wbeta-home-chat-primary" aria-label="Workspace chat">
        {chat}
      </section>
    </div>
  );
}
