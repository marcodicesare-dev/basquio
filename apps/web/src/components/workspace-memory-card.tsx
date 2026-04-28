import Link from "next/link";
import { ArrowRight, Sparkle } from "@phosphor-icons/react/dist/ssr";

import type { MemoryCounts } from "@/lib/workspace/inspector";

type Props = {
  counts: MemoryCounts;
};

/**
 * Workspace-home memory card. Anticipation surface, not a counter. Per
 * SOTA research (Harvey Memory, Notion Skills, Linear Magic), the home
 * card narrates what the agent learned and invites a next action.
 * Numbers belong in /workspace/memory, not on home.
 *
 * The card always links to /workspace/memory so the user can drill in.
 *
 * Class namespace `wbeta-home-memory-*` is intentionally separate from
 * `wbeta-memory-card-*` (used by the inspector's individual entry
 * cards). Two different cards, two different roles, two namespaces.
 */
export function WorkspaceMemoryCard({ counts }: Props) {
  const totalRemembered = counts.entities + counts.facts + counts.activeRules;
  const empty = totalRemembered === 0 && counts.pendingCandidates === 0;
  const sparse = totalRemembered > 0 && totalRemembered < 5;

  return (
    <Link href="/workspace/memory" className="wbeta-home-memory">
      <span className="wbeta-home-memory-icon" aria-hidden>
        <Sparkle size={16} weight="fill" />
      </span>
      <span className="wbeta-home-memory-body">
        <span className="wbeta-home-memory-title">
          {empty
            ? "Tell me what to remember about your clients."
            : sparse
              ? "I am starting to remember a few things about your work."
              : `I am remembering ${totalRemembered} things about your work.`}
        </span>
        <span className="wbeta-home-memory-hint">
          {empty
            ? "Drop a brief, an export, or ask me a question. I will start saving what matters."
            : counts.pendingCandidates > 0
              ? `${counts.pendingCandidates} ${
                  counts.pendingCandidates === 1 ? "item is" : "items are"
                } waiting for you to confirm.`
              : "Open my memory to see what I know and pin what should never change."}
        </span>
      </span>
      <span className="wbeta-home-memory-arrow" aria-hidden>
        <ArrowRight size={14} weight="bold" />
      </span>
    </Link>
  );
}
