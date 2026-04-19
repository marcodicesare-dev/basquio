import {
  countProcessingDocuments,
  listRecentWorkspaceDocuments,
  listWorkspaceEntitiesGrouped,
} from "@/lib/workspace/db";
import { WorkspaceUploadZone } from "@/components/workspace-upload-zone";
import { WorkspaceDocumentList } from "@/components/workspace-document-list";
import { WorkspaceTimeline } from "@/components/workspace-timeline";
import { WorkspaceAutoRefresh } from "@/components/workspace-auto-refresh";
import { SUPPORTED_UPLOAD_LABEL } from "@/lib/workspace/constants";

export const metadata = {
  title: "Workspace · Basquio",
};

export const dynamic = "force-dynamic";

export default async function WorkspaceHomePage() {
  const [documents, entitiesByType] = await Promise.all([
    listRecentWorkspaceDocuments(20),
    listWorkspaceEntitiesGrouped(),
  ]);

  const processingCount = countProcessingDocuments(documents);
  const totalEntityCount = Object.values(entitiesByType).reduce(
    (sum, group) => sum + group.length,
    0,
  );

  return (
    <div className="wbeta-home">
      <WorkspaceAutoRefresh processingCount={processingCount} />

      <aside className="wbeta-context">
        <div className="wbeta-context-head">
          <p className="wbeta-context-kicker">What Basquio knows</p>
          <h2 className="wbeta-context-title">Timeline</h2>
        </div>

        <WorkspaceTimeline
          entitiesByType={entitiesByType}
          totalEntityCount={totalEntityCount}
        />
      </aside>

      <section className="wbeta-main-col">
        <div className="wbeta-prompt-shell">
          <label className="wbeta-prompt-label" htmlFor="wbeta-prompt-disabled">
            Ask anything
          </label>
          <input
            id="wbeta-prompt-disabled"
            className="wbeta-prompt-input"
            placeholder="A direct answer or a deliverable. Wired up next."
            disabled
          />
          <p className="wbeta-prompt-hint">
            The ask anything input lands with memory and citations in the next pass.
          </p>
        </div>

        <WorkspaceUploadZone supportedLabel={SUPPORTED_UPLOAD_LABEL} />

        <WorkspaceDocumentList documents={documents} />
      </section>
    </div>
  );
}
