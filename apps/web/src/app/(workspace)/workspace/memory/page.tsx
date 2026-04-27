import { WorkspaceBreadcrumb } from "@/components/workspace-breadcrumb";
import { MemoryBrowser } from "@/components/workspace-memory-browser";
import { WorkspaceCandidateQueue } from "@/components/workspace-candidate-queue";
import { listPendingCandidates } from "@/lib/workspace/candidates";
import { listMemoryEntries, MEMORY_TYPE_LABELS } from "@/lib/workspace/memory";
import { listScopes } from "@/lib/workspace/scopes";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Knowledge · Basquio",
};

export default async function WorkspaceMemoryPage() {
  const workspace = await getCurrentWorkspace();
  const [scopes, entries, pendingCandidates] = await Promise.all([
    listScopes(workspace.id),
    listMemoryEntries({ workspaceId: workspace.id }),
    listPendingCandidates(workspace.id).catch((err) => {
      console.error("[memory page] listPendingCandidates failed", err);
      return [];
    }),
  ]);

  const byType = {
    procedural: entries.filter((e) => e.memory_type === "procedural").length,
    semantic: entries.filter((e) => e.memory_type === "semantic").length,
    episodic: entries.filter((e) => e.memory_type === "episodic").length,
  };
  const scopeCount = new Set(entries.map((e) => e.workspace_scope_id).filter(Boolean)).size;

  return (
    <div className="wbeta-memory-page">
      <WorkspaceBreadcrumb items={[{ href: "/workspace", label: "Home" }, { label: "Knowledge" }]} />

      <header className="wbeta-memory-head">
        <p className="wbeta-memory-eyebrow">Knowledge</p>
        <h1 className="wbeta-memory-title">What Basquio knows.</h1>
        <p className="wbeta-memory-summary">
          Saved context, instructions, and examples Basquio can reuse in answers. Upload files in
          Sources when Basquio should cite evidence from documents.
        </p>
        <ul className="wbeta-memory-stats">
          <li>
            <span className="wbeta-memory-stat-num">{byType.semantic}</span>
            <span className="wbeta-memory-stat-label">{MEMORY_TYPE_LABELS.semantic}</span>
          </li>
          <li>
            <span className="wbeta-memory-stat-num">{byType.procedural}</span>
            <span className="wbeta-memory-stat-label">{MEMORY_TYPE_LABELS.procedural}</span>
          </li>
          <li>
            <span className="wbeta-memory-stat-num">{byType.episodic}</span>
            <span className="wbeta-memory-stat-label">{MEMORY_TYPE_LABELS.episodic}</span>
          </li>
          <li>
            <span className="wbeta-memory-stat-num">{scopeCount}</span>
            <span className="wbeta-memory-stat-label">contexts</span>
          </li>
        </ul>
      </header>

      <WorkspaceCandidateQueue initialCandidates={pendingCandidates} />

      <MemoryBrowser initialEntries={entries} scopes={scopes} />
    </div>
  );
}
