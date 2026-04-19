import { listRecentWorkspaceDocuments } from "@/lib/workspace/db";
import { WorkspaceUploadZone } from "@/components/workspace-upload-zone";
import { WorkspaceDocumentList } from "@/components/workspace-document-list";
import { SUPPORTED_UPLOAD_LABEL } from "@/lib/workspace/constants";

export const metadata = {
  title: "Workspace · Basquio",
};

export const dynamic = "force-dynamic";

export default async function WorkspaceHomePage() {
  const documents = await listRecentWorkspaceDocuments(20);

  return (
    <div className="wbeta-home">
      <aside className="wbeta-context">
        <div className="wbeta-context-head">
          <p className="wbeta-context-kicker">What Basquio knows</p>
          <h2 className="wbeta-context-title">Timeline</h2>
        </div>

        <div className="wbeta-context-empty">
          <p className="wbeta-context-empty-line">
            People, brands, categories, retailers, metrics, and deliverables land here as soon as
            extraction runs on your uploads.
          </p>
          <p className="wbeta-context-empty-meta">Coming next: live entity counts grouped by type.</p>
        </div>
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
