import Link from "next/link";

import type { MemoryCounts } from "@/lib/workspace/inspector";

type Props = {
  counts: MemoryCounts;
};

/**
 * Workspace-home "Your workspace remembers" card. Surfaces the moat on
 * the page the analyst spends 80% of their time on. Counts come from
 * getWorkspaceMemoryCounts; the card links to /workspace/memory.
 *
 * Renders even at all-zero state because the empty case is the most
 * important one to communicate ("Basquio is ready to start
 * remembering"). The first signal lands here as soon as the user
 * uploads a source or has a chat turn.
 */
export function WorkspaceMemoryCard({ counts }: Props) {
  const empty =
    counts.entities === 0 &&
    counts.facts === 0 &&
    counts.activeRules === 0 &&
    counts.pendingCandidates === 0;

  return (
    <Link href="/workspace/memory" className="wbeta-memory-card">
      <span className="wbeta-memory-card-eyebrow">Your workspace remembers</span>
      {empty ? (
        <span className="wbeta-memory-card-empty">
          Nothing yet. Upload a source or start a chat; entities, facts, and rules will land here.
        </span>
      ) : (
        <span className="wbeta-memory-card-counts">
          <span>
            <strong>{counts.entities}</strong> {counts.entities === 1 ? "entity" : "entities"}
          </span>
          <span>·</span>
          <span>
            <strong>{counts.facts}</strong> {counts.facts === 1 ? "fact" : "facts"}
          </span>
          <span>·</span>
          <span>
            <strong>{counts.activeRules}</strong> {counts.activeRules === 1 ? "rule" : "rules"}
          </span>
          {counts.pendingCandidates > 0 ? (
            <>
              <span>·</span>
              <span className="wbeta-memory-card-pending">
                <strong>{counts.pendingCandidates}</strong> pending review
              </span>
            </>
          ) : null}
        </span>
      )}
    </Link>
  );
}
