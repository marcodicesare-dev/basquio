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

export default async function WorkspaceHomePage() {
  const [documents, entitiesByType, deliverables, suggestions] = await Promise.all([
    listRecentWorkspaceDocuments(20),
    listWorkspaceEntitiesGrouped(),
    listRecentWorkspaceDeliverables(8),
    buildSuggestions(3),
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
        <WorkspacePrompt />

        <WorkspaceDeliverablesList deliverables={deliverables} />

        <WorkspaceUploadZone supportedLabel={SUPPORTED_UPLOAD_LABEL} />

        <WorkspaceDocumentList documents={documents} />
      </section>
    </div>
  );
}
