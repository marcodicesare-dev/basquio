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
import type { MemoryRow, WorkspaceRule } from "@/lib/workspace/types";
import { listScopes } from "@/lib/workspace/scopes";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

/**
 * Bridge legacy memory_entries (memory_type='procedural') into the
 * Inspector's WorkspaceRule shape. Functionally these are rules the
 * user has taught Basquio in chat; until the two stores are merged at
 * the data-model level, the inspector renders both. The bridge is
 * lossy on rule_type (we always use "always") and origin (always
 * "user"), which is correct: the chat-taught entries do not have a
 * structured rule type, and the user explicitly asked Basquio to
 * remember them.
 *
 * Strips leading markdown markers (`# `, `## `, `* `, `- `) from the
 * memory_entries content because some rules saved by older flows had
 * a markdown title prefix that leaked into the rule card and looked
 * like raw markdown in the UI.
 */
function proceduralMemoryAsRule(entry: MemoryRow, workspaceId: string): WorkspaceRule {
  return {
    id: entry.id,
    workspace_id: entry.workspace_id ?? workspaceId,
    scope_id: entry.workspace_scope_id,
    rule_type: "always",
    rule_text: stripLeadingMarkdown(entry.content),
    applies_to: [],
    forbidden: [],
    origin: "user",
    origin_evidence: [],
    priority: 0,
    active: true,
    valid_from: null,
    valid_to: null,
    expired_at: null,
    confidence: 1,
    approved_by: null,
    approved_at: entry.created_at,
    last_applied_at: null,
    metadata: { ...entry.metadata, source_table: "memory_entries" },
    created_at: entry.created_at,
    updated_at: entry.updated_at,
  };
}

function stripLeadingMarkdown(content: string): string {
  // Remove leading "# ", "## ", "### ", "* ", "- " from each non-empty
  // line so a memory entry that was saved with a markdown header (e.g.
  // "# Chart conventions for Mulino Bianco - Elena Bianchi prefers...")
  // renders as plain prose in the rule card. The actual rule text
  // semantics do not change; only the typographic clutter goes away.
  return content
    .split("\n")
    .map((line) => line.replace(/^\s*(?:#{1,6}\s+|[*\-]\s+)/, ""))
    .join("\n")
    .trim();
}

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Memory · Basquio",
};

export default async function WorkspaceMemoryPage() {
  const workspace = await getCurrentWorkspace();
  const inspectorV2 = isMemoryInspectorV2Enabled();

  if (inspectorV2) {
    const [
      entities,
      facts,
      rules,
      proceduralMemories,
      candidates,
      factCounts,
    ] = await Promise.all([
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
      // Bridge the legacy memory_entries store. The chat tool reads from
      // here, so the inspector must too: showing 0 rules while the chat
      // cites 2 saved items is the bug Marco flagged.
      listMemoryEntries({ workspaceId: workspace.id, memoryType: "procedural" }).catch(
        (err) => {
          console.error("[memory page v2] listMemoryEntries(procedural) failed", err);
          return [];
        },
      ),
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

    const mergedRules: WorkspaceRule[] = [
      ...rules,
      ...proceduralMemories.map((entry) => proceduralMemoryAsRule(entry, workspace.id)),
    ];

    return (
      <div className="wbeta-memory-page">
        <WorkspaceBreadcrumb items={[{ href: "/workspace", label: "Home" }, { label: "Memory" }]} />

        <header className="wbeta-memory-head">
          <p className="wbeta-memory-eyebrow">Memory</p>
          <h1 className="wbeta-memory-title">What Basquio remembers about your workspace.</h1>
          <p className="wbeta-memory-summary">
            People, brands, retailers, and metrics it has learned. Numbers it has read and
            confirmed. Rules you have taught it. Things waiting for your review. Pin what
            should never change. Forget what is wrong.
          </p>
          <ul className="wbeta-memory-stats">
            <li>
              <span className="wbeta-memory-stat-num">{entities.length}</span>
              <span className="wbeta-memory-stat-label">things</span>
            </li>
            <li>
              <span className="wbeta-memory-stat-num">{facts.length}</span>
              <span className="wbeta-memory-stat-label">facts</span>
            </li>
            <li>
              <span className="wbeta-memory-stat-num">{mergedRules.length}</span>
              <span className="wbeta-memory-stat-label">rules</span>
            </li>
            <li>
              <span className="wbeta-memory-stat-num">{candidates.length}</span>
              <span className="wbeta-memory-stat-label">waiting for you</span>
            </li>
          </ul>
        </header>

        <WorkspaceMemoryInspectorV2
          entities={entities}
          facts={facts}
          rules={mergedRules}
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
