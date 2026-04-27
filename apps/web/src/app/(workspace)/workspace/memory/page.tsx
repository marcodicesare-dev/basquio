import { WorkspaceBreadcrumb } from "@/components/workspace-breadcrumb";
import { MemoryBrowser } from "@/components/workspace-memory-browser";
import { WorkspaceCandidateQueue } from "@/components/workspace-candidate-queue";
import { WorkspaceMemoryInspectorV2 } from "@/components/workspace-memory-inspector";
import { listPendingCandidates } from "@/lib/workspace/candidates";
import {
  countFactsByEntity,
  isMemoryInspectorV2Enabled,
  listInspectorEntities,
  listInspectorFacts,
} from "@/lib/workspace/inspector";
import { listMemoryEntries, MEMORY_TYPE_LABELS } from "@/lib/workspace/memory";
import { listAllRules } from "@/lib/workspace/rules";
import { listScopes } from "@/lib/workspace/scopes";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Memory · Basquio",
};

export default async function WorkspaceMemoryPage() {
  const workspace = await getCurrentWorkspace();
  const inspectorV2 = isMemoryInspectorV2Enabled();

  if (inspectorV2) {
    const [entities, facts, rules, candidates, factCounts] = await Promise.all([
      listInspectorEntities(workspace.id).catch((err) => {
        console.error("[memory page v2] listInspectorEntities failed", err);
        return [];
      }),
      listInspectorFacts(workspace.id).catch((err) => {
        console.error("[memory page v2] listInspectorFacts failed", err);
        return [];
      }),
      listAllRules(workspace.id).catch((err) => {
        console.error("[memory page v2] listAllRules failed", err);
        return [];
      }),
      listPendingCandidates(workspace.id).catch((err) => {
        console.error("[memory page v2] listPendingCandidates failed", err);
        return [];
      }),
      countFactsByEntity(workspace.id).catch((err) => {
        console.error("[memory page v2] countFactsByEntity failed", err);
        return new Map<string, number>();
      }),
    ]);
    const factCountByEntity: Record<string, number> = {};
    for (const [k, v] of factCounts.entries()) factCountByEntity[k] = v;

    return (
      <div className="wbeta-memory-page">
        <WorkspaceBreadcrumb items={[{ href: "/workspace", label: "Home" }, { label: "Memory" }]} />

        <header className="wbeta-memory-head">
          <p className="wbeta-memory-eyebrow">Memory</p>
          <h1 className="wbeta-memory-title">Memory Inspector</h1>
          <p className="wbeta-memory-summary">
            Entities, facts, rules, and pending candidates Basquio knows about this workspace.
            Pin / Edit / Forget actions on rules write to the audit log; durable changes are
            traceable forever.
          </p>
          <ul className="wbeta-memory-stats">
            <li>
              <span className="wbeta-memory-stat-num">{entities.length}</span>
              <span className="wbeta-memory-stat-label">entities</span>
            </li>
            <li>
              <span className="wbeta-memory-stat-num">{facts.length}</span>
              <span className="wbeta-memory-stat-label">facts</span>
            </li>
            <li>
              <span className="wbeta-memory-stat-num">{rules.length}</span>
              <span className="wbeta-memory-stat-label">rules</span>
            </li>
            <li>
              <span className="wbeta-memory-stat-num">{candidates.length}</span>
              <span className="wbeta-memory-stat-label">pending</span>
            </li>
          </ul>
        </header>

        <WorkspaceMemoryInspectorV2
          entities={entities}
          facts={facts}
          rules={rules}
          candidates={candidates}
          factCountByEntity={factCountByEntity}
        />
      </div>
    );
  }

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
      <WorkspaceBreadcrumb items={[{ href: "/workspace", label: "Home" }, { label: "Memory" }]} />

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
