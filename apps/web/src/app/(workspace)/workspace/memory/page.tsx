import { WorkspaceBreadcrumb } from "@/components/workspace-breadcrumb";
import { MemoryBrowser } from "@/components/workspace-memory-browser";
import { listMemoryEntries, MEMORY_TYPE_LABELS } from "@/lib/workspace/memory";
import { listScopes } from "@/lib/workspace/scopes";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Memory · Basquio",
};

export default async function WorkspaceMemoryPage() {
  const workspace = await getCurrentWorkspace();
  const [scopes, entries] = await Promise.all([
    listScopes(workspace.id),
    listMemoryEntries({ workspaceId: workspace.id }),
  ]);

  const byType = {
    procedural: entries.filter((e) => e.memory_type === "procedural").length,
    semantic: entries.filter((e) => e.memory_type === "semantic").length,
    episodic: entries.filter((e) => e.memory_type === "episodic").length,
  };
  const scopeCount = new Set(entries.map((e) => e.workspace_scope_id).filter(Boolean)).size;

  return (
    <div className="wbeta-memory-page">
      <WorkspaceBreadcrumb items={[{ href: "/workspace", label: "Home" }, { label: "Memory" }]} />

      <header className="wbeta-memory-head">
        <p className="wbeta-memory-eyebrow">Memory</p>
        <h1 className="wbeta-memory-title">Everything you&apos;ve taught Basquio.</h1>
        <p className="wbeta-memory-summary">
          Every rule, fact, and win below is used when you ask a question. Edit the content to
          correct Basquio, pin the important ones so they never drop out of context, archive what
          does not apply anymore.
        </p>
        <ul className="wbeta-memory-stats">
          <li>
            <span className="wbeta-memory-stat-num">{byType.procedural}</span>
            <span className="wbeta-memory-stat-label">{MEMORY_TYPE_LABELS.procedural}</span>
          </li>
          <li>
            <span className="wbeta-memory-stat-num">{byType.semantic}</span>
            <span className="wbeta-memory-stat-label">{MEMORY_TYPE_LABELS.semantic}</span>
          </li>
          <li>
            <span className="wbeta-memory-stat-num">{byType.episodic}</span>
            <span className="wbeta-memory-stat-label">{MEMORY_TYPE_LABELS.episodic}</span>
          </li>
          <li>
            <span className="wbeta-memory-stat-num">{scopeCount}</span>
            <span className="wbeta-memory-stat-label">scopes</span>
          </li>
        </ul>
      </header>

      <MemoryBrowser initialEntries={entries} scopes={scopes} />
    </div>
  );
}
