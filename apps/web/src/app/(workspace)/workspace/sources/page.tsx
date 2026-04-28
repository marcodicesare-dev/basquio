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
        <h1 className="wbeta-sources-title">The files Basquio reads when answering you.</h1>
        <p className="wbeta-sources-summary">
          Drop a brief, an export, a transcript, or a deck. Basquio reads it once and cites it
          forever. Files here are reusable across chats and decks; chat attachments stay one-off.
        </p>
        <ul className="wbeta-sources-stats">
          <li>
            <span className="wbeta-sources-stat-num">{documents.length}</span>
            <span className="wbeta-sources-stat-label">files in your repository</span>
          </li>
          <li>
            <span className="wbeta-sources-stat-num">{readyDocuments}</span>
            <span className="wbeta-sources-stat-label">ready to cite</span>
          </li>
          <li>
            <span className="wbeta-sources-stat-num">{processingDocuments}</span>
            <span className="wbeta-sources-stat-label">still reading</span>
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
              Add files
            </h2>
            <p className="wbeta-sources-section-copy">
              Files added here are reusable across every chat and deck. Chat attachments still
              work for one-off questions you do not need to keep.
            </p>
          </div>
        </div>
        <WorkspaceUploadZone
          variant="inline"
          title="Drop files here"
          subtitle={`${SUPPORTED_SOURCE_FILES}. Up to 50 MB.`}
          supportedLabel={SUPPORTED_SOURCE_FILES}
        />
      </section>

      <section className="wbeta-sources-section" aria-labelledby="sources-library-title">
        <div className="wbeta-sources-section-head">
          <div>
            <h2 id="sources-library-title" className="wbeta-sources-section-title">
              Your files
            </h2>
            <p className="wbeta-sources-section-copy">
              Click a file to preview it. Download keeps the original untouched.
            </p>
          </div>
        </div>
        <WorkspaceDocumentList
          documents={documents}
          title="Your files"
          emptyTitle="No files yet."
          emptyBody={
            "Drop a deck, a brief, a transcript, a dataset, or a category note above. " +
            "Once Basquio reads it, every chat answer can cite it."
          }
        />
      </section>

      <section className="wbeta-sources-section" aria-labelledby="sources-web-title">
        <div className="wbeta-sources-section-head">
          <div>
            <h2 id="sources-web-title" className="wbeta-sources-section-title">
              Web sources
            </h2>
            <p className="wbeta-sources-section-copy">
              Pages Basquio reads on the open web when your files are not enough.
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
