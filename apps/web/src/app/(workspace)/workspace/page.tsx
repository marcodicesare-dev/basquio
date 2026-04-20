import { getViewerState } from "@/lib/supabase/auth";
import {
  countProcessingDocuments,
  listRecentWorkspaceDeliverables,
  listRecentWorkspaceDocuments,
  listWorkspaceEntitiesGrouped,
} from "@/lib/workspace/db";
import { WorkspaceUploadZone } from "@/components/workspace-upload-zone";
import { WorkspaceDocumentList } from "@/components/workspace-document-list";
import { WorkspaceTimeline } from "@/components/workspace-timeline";
import { WorkspaceAutoRefresh } from "@/components/workspace-auto-refresh";
import { WorkspaceChat } from "@/components/workspace-chat/Chat";
import { WorkspaceDeliverablesList } from "@/components/workspace-deliverables-list";
import { WorkspaceSuggestions } from "@/components/workspace-suggestions";
import { WorkspaceShortcuts } from "@/components/workspace-shortcuts";
import { WorkspaceOnboarding } from "@/components/workspace-onboarding";
import { buildSuggestions } from "@/lib/workspace/suggestions";
import { SUPPORTED_UPLOAD_LABEL } from "@/lib/workspace/constants";
import { getCurrentWorkspace, isWorkspaceOnboarded } from "@/lib/workspace/workspaces";

export const metadata = {
  title: "Workspace · Basquio",
};

export const dynamic = "force-dynamic";

async function safe<T>(promise: Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    console.error(`[workspace] ${label} failed`, error);
    return fallback;
  }
}

export default async function WorkspaceHomePage() {
  const [viewer, workspace, documents, entitiesByType, deliverables, suggestions] =
    await Promise.all([
      getViewerState(),
      getCurrentWorkspace(),
      safe(listRecentWorkspaceDocuments(20), [], "list documents"),
      safe(listWorkspaceEntitiesGrouped(), {}, "list entities"),
      safe(listRecentWorkspaceDeliverables(8), [], "list deliverables"),
      safe(buildSuggestions(3), [], "build suggestions"),
    ]);

  const processingCount = countProcessingDocuments(documents);
  const totalEntityCount = Object.values(entitiesByType).reduce(
    (sum, group) => sum + group.length,
    0,
  );
  const isEmpty = documents.length === 0 && deliverables.length === 0 && totalEntityCount === 0;
  const userEmail = viewer.user?.email ?? null;
  const onboarded = isWorkspaceOnboarded(workspace);

  if (!onboarded && isEmpty) {
    return (
      <div className="wbeta-page wbeta-page-onboard">
        <WorkspaceOnboarding />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="wbeta-page wbeta-page-empty">
        <WorkspaceAutoRefresh processingCount={processingCount} />
        <WorkspaceShortcuts />

        <header className="wbeta-hero">
          <p className="wbeta-hero-eyebrow">Workspace</p>
          <h1 className="wbeta-hero-title">Your analyst memory, always there.</h1>
          <p className="wbeta-hero-lede">
            Basquio knows your clients, stakeholders, and style. Ask a question, get the answer your
            client expects. Every answer cites where it came from.
          </p>
        </header>

        <section className="wbeta-hero-drop">
          <WorkspaceUploadZone supportedLabel={SUPPORTED_UPLOAD_LABEL} variant="hero" />
        </section>

        <section className="wbeta-hero-prompt">
          <WorkspaceChat />
        </section>

        <p className="wbeta-hero-shortcuts">
          Cmd+U to upload. Cmd+K to focus the prompt. Cmd+/ for the full list.
        </p>
      </div>
    );
  }

  return (
    <div className="wbeta-page">
      <WorkspaceAutoRefresh processingCount={processingCount} />
      <WorkspaceShortcuts />

      <header className="wbeta-page-head">
        <div>
          <p className="wbeta-page-eyebrow">Workspace</p>
          <h1 className="wbeta-page-title">
            {userEmail ? userEmail.split("@")[0].replace(/\./g, " ") : "your workspace"}
          </h1>
        </div>
        <div className="wbeta-page-summary">
          <span className="wbeta-stat">
            <span className="wbeta-stat-num">{documents.length}</span>
            <span className="wbeta-stat-label">files</span>
          </span>
          <span className="wbeta-stat-sep" aria-hidden>
            ·
          </span>
          <span className="wbeta-stat">
            <span className="wbeta-stat-num">{totalEntityCount}</span>
            <span className="wbeta-stat-label">entities</span>
          </span>
          <span className="wbeta-stat-sep" aria-hidden>
            ·
          </span>
          <span className="wbeta-stat">
            <span className="wbeta-stat-num">{deliverables.length}</span>
            <span className="wbeta-stat-label">answers</span>
          </span>
        </div>
      </header>

      <div className="wbeta-grid">
        <aside className="wbeta-aside">
          <section className="wbeta-section">
            <header className="wbeta-section-head">
              <h2 className="wbeta-section-title">Timeline</h2>
              <p className="wbeta-section-meta">What Basquio knows</p>
            </header>
            <WorkspaceTimeline
              entitiesByType={entitiesByType}
              totalEntityCount={totalEntityCount}
            />
          </section>

          {suggestions.length > 0 ? (
            <section className="wbeta-section">
              <header className="wbeta-section-head">
                <h2 className="wbeta-section-title">Try this</h2>
              </header>
              <WorkspaceSuggestions initialSuggestions={suggestions} />
            </section>
          ) : null}
        </aside>

        <section className="wbeta-content">
          <WorkspaceChat />

          {deliverables.length > 0 ? (
            <section className="wbeta-section">
              <header className="wbeta-section-head">
                <h2 className="wbeta-section-title">Recent answers</h2>
                <p className="wbeta-section-meta">{deliverables.length} in the last weeks</p>
              </header>
              <WorkspaceDeliverablesList deliverables={deliverables} />
            </section>
          ) : null}

          <section className="wbeta-section">
            <header className="wbeta-section-head">
              <h2 className="wbeta-section-title">Add to the workspace</h2>
              <p className="wbeta-section-meta">Drop a file or paste text. Parsing runs in seconds.</p>
            </header>
            <WorkspaceUploadZone supportedLabel={SUPPORTED_UPLOAD_LABEL} variant="inline" />
          </section>

          {documents.length > 0 ? (
            <section className="wbeta-section">
              <header className="wbeta-section-head">
                <h2 className="wbeta-section-title">Files</h2>
                <p className="wbeta-section-meta">{documents.length} indexed</p>
              </header>
              <WorkspaceDocumentList documents={documents} />
            </section>
          ) : null}
        </section>
      </div>
    </div>
  );
}
