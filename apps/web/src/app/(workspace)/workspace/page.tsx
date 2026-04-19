import {
  countProcessingDocuments,
  inferDefaultScope,
  listKnownScopes,
  listRecentWorkspaceDeliverables,
  listRecentWorkspaceDocuments,
  listWorkspaceEntitiesGrouped,
} from "@/lib/workspace/db";
import { WorkspaceUploadZone } from "@/components/workspace-upload-zone";
import { WorkspaceDocumentList } from "@/components/workspace-document-list";
import { WorkspaceTimeline } from "@/components/workspace-timeline";
import { WorkspaceAutoRefresh } from "@/components/workspace-auto-refresh";
import { WorkspacePrompt } from "@/components/workspace-prompt";
import { WorkspaceDeliverablesList } from "@/components/workspace-deliverables-list";
import { WorkspaceSuggestions } from "@/components/workspace-suggestions";
import { WorkspaceShortcuts } from "@/components/workspace-shortcuts";
import { buildSuggestions } from "@/lib/workspace/suggestions";
import { SUPPORTED_UPLOAD_LABEL } from "@/lib/workspace/constants";

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
  const [documents, entitiesByType, deliverables, suggestions, scopes, defaultScope] = await Promise.all([
    safe(listRecentWorkspaceDocuments(20), [], "list documents"),
    safe(listWorkspaceEntitiesGrouped(), {}, "list entities"),
    safe(listRecentWorkspaceDeliverables(8), [], "list deliverables"),
    safe(buildSuggestions(3), [], "build suggestions"),
    safe(listKnownScopes(12), ["workspace", "analyst"], "list scopes"),
    safe(inferDefaultScope(), "workspace", "infer default scope"),
  ]);

  const processingCount = countProcessingDocuments(documents);
  const totalEntityCount = Object.values(entitiesByType).reduce(
    (sum, group) => sum + group.length,
    0,
  );

  return (
    <div className="wbeta-home">
      <WorkspaceAutoRefresh processingCount={processingCount} />
      <WorkspaceShortcuts />

      <aside className="wbeta-context">
        <div className="wbeta-context-head">
          <p className="wbeta-context-kicker">What Basquio knows</p>
          <h2 className="wbeta-context-title">Timeline</h2>
        </div>

        <WorkspaceTimeline
          entitiesByType={entitiesByType}
          totalEntityCount={totalEntityCount}
        />

        {suggestions.length > 0 ? (
          <WorkspaceSuggestions initialSuggestions={suggestions} />
        ) : null}
      </aside>

      <section className="wbeta-main-col">
        <WorkspacePrompt scopes={scopes} defaultScope={defaultScope} />

        {documents.length === 0 ? (
          <>
            <WorkspaceUploadZone supportedLabel={SUPPORTED_UPLOAD_LABEL} />
            <WorkspaceDocumentList documents={documents} />
          </>
        ) : (
          <>
            <WorkspaceDeliverablesList deliverables={deliverables} />
            <WorkspaceUploadZone supportedLabel={SUPPORTED_UPLOAD_LABEL} />
            <WorkspaceDocumentList documents={documents} />
          </>
        )}
      </section>
    </div>
  );
}
