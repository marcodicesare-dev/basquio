import { WorkspaceBreadcrumb } from "@/components/workspace-breadcrumb";
import { WorkspaceDocumentList } from "@/components/workspace-document-list";
import { WorkspaceUploadZone } from "@/components/workspace-upload-zone";
import {
  listWorkspaceSourceCatalog,
  listWorkspaceSourceDocuments,
  type WorkspaceSourceCatalogRow,
  type WorkspaceSourceDocumentRow,
} from "@/lib/workspace/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sources | Basquio",
};

const SUPPORTED_SOURCE_FILES =
  "PDF, PPTX, DOCX, XLSX, CSV, images, audio, markdown, text, JSON, and YAML";

async function safe<T>(promise: Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    console.error(`[workspace sources] ${label} failed`, error);
    return fallback;
  }
}

export default async function WorkspaceSourcesPage() {
  const [documents, sourceCatalog] = await Promise.all([
    safe<WorkspaceSourceDocumentRow[]>(
      listWorkspaceSourceDocuments(150),
      [],
      "list source documents",
    ),
    safe<WorkspaceSourceCatalogRow[]>(
      listWorkspaceSourceCatalog(150),
      [],
      "list source catalog",
    ),
  ]);

  const readyDocuments = documents.filter((doc) => doc.status === "indexed").length;
  const processingDocuments = documents.filter((doc) => doc.status === "processing").length;
  const activeSources = sourceCatalog.filter((source) => source.status === "active").length;

  return (
    <div className="wbeta-sources-page">
      <WorkspaceBreadcrumb
        items={[{ href: "/workspace", label: "Home" }, { label: "Sources" }]}
      />

      <header className="wbeta-sources-head">
        <p className="wbeta-sources-eyebrow">Sources</p>
        <h1 className="wbeta-sources-title">The files Basquio can retrieve from.</h1>
        <p className="wbeta-sources-summary">
          Upload reusable workspace files here. Basquio indexes them into retrieval so chat answers
          can cite filename-backed excerpts, and deck briefs can carry the cited files forward.
        </p>
        <ul className="wbeta-sources-stats">
          <li>
            <span className="wbeta-sources-stat-num">{documents.length}</span>
            <span className="wbeta-sources-stat-label">repository files</span>
          </li>
          <li>
            <span className="wbeta-sources-stat-num">{readyDocuments}</span>
            <span className="wbeta-sources-stat-label">ready to cite</span>
          </li>
          <li>
            <span className="wbeta-sources-stat-num">{processingDocuments}</span>
            <span className="wbeta-sources-stat-label">processing</span>
          </li>
          <li>
            <span className="wbeta-sources-stat-num">{activeSources}</span>
            <span className="wbeta-sources-stat-label">web sources</span>
          </li>
        </ul>
      </header>

      <section className="wbeta-sources-upload" aria-labelledby="sources-upload-title">
        <div className="wbeta-sources-section-head">
          <div>
            <h2 id="sources-upload-title" className="wbeta-sources-section-title">
              Add repository files
            </h2>
            <p className="wbeta-sources-section-copy">
              Chat attachments still work for one-off questions. Files placed here become the
              reusable source repository for future chats and decks.
            </p>
          </div>
        </div>
        <WorkspaceUploadZone
          variant="hero"
          title="Drop source files."
          subtitle={`Or click anywhere on this card. ${SUPPORTED_SOURCE_FILES}. Up to 50 MB.`}
          supportedLabel={SUPPORTED_SOURCE_FILES}
        />
      </section>

      <section className="wbeta-sources-section" aria-labelledby="sources-library-title">
        <div className="wbeta-sources-section-head">
          <div>
            <h2 id="sources-library-title" className="wbeta-sources-section-title">
              Internal source repository
            </h2>
            <p className="wbeta-sources-section-copy">
              These uploaded files are eligible for workspace retrieval. When Basquio uses one, the
              answer should cite the source label and filename.
            </p>
          </div>
        </div>
        <WorkspaceDocumentList
          documents={documents}
          title="Repository files"
          emptyTitle="No source files yet."
          emptyBody={
            "Upload a deck, brief, transcript, dataset, or category note above. " +
            "Once indexed, Basquio can retrieve excerpts from it and cite the filename in chat."
          }
        />
      </section>

      <section className="wbeta-sources-section" aria-labelledby="sources-web-title">
        <div className="wbeta-sources-section-head">
          <div>
            <h2 id="sources-web-title" className="wbeta-sources-section-title">
              External research catalog
            </h2>
            <p className="wbeta-sources-section-copy">
              Curated web sources used when workspace files are not enough for market research.
            </p>
          </div>
          <p className="wbeta-sources-section-meta">{activeSources} active</p>
        </div>

        {sourceCatalog.length > 0 ? (
          <ul className="wbeta-source-catalog">
            {sourceCatalog.map((source) => (
              <li key={source.id} className="wbeta-source-catalog-row">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="wbeta-source-catalog-main"
                >
                  <span className="wbeta-source-catalog-host">{source.host}</span>
                  <span className="wbeta-source-catalog-url">{source.url}</span>
                </a>
                <span
                  className={`wbeta-source-catalog-status wbeta-source-catalog-status-${source.status}`}
                >
                  {source.status}
                </span>
                <span className="wbeta-source-catalog-meta">
                  Tier {source.tier} / {sourceTypeLabel(source.source_type)} / Trust{" "}
                  {source.trust_score}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="wbeta-sources-empty">
            <p className="wbeta-sources-empty-title">No external catalog rows found.</p>
            <p className="wbeta-sources-empty-body">
              Internal uploaded files still work. External source catalog rows can be added later by
              the research layer.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function sourceTypeLabel(value: string): string {
  return value.replaceAll("_", " ");
}
