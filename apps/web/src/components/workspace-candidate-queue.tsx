"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { MemoryCandidateRow } from "@/lib/workspace/candidates";

type Props = {
  initialCandidates: MemoryCandidateRow[];
};

type ActionState =
  | { kind: "idle" }
  | { kind: "pending"; candidateId: string }
  | { kind: "error"; candidateId: string; message: string };

const KIND_LABEL: Record<MemoryCandidateRow["kind"], string> = {
  fact: "Fact",
  rule: "Rule",
  preference: "Preference",
  alias: "Alias",
  entity: "Entity",
};

export function WorkspaceCandidateQueue({ initialCandidates }: Props) {
  const router = useRouter();
  const [candidates, setCandidates] = useState(initialCandidates);
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  async function approve(candidateId: string) {
    setState({ kind: "pending", candidateId });
    try {
      const response = await fetch(`/api/workspace/candidates/${candidateId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ edits: {} }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Approval failed.");
      }
      setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
      setState({ kind: "idle" });
      startTransition(() => router.refresh());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Approval failed.";
      setState({ kind: "error", candidateId, message });
    }
  }

  async function dismiss(candidateId: string, reason: string) {
    setState({ kind: "pending", candidateId });
    try {
      const response = await fetch(`/api/workspace/candidates/${candidateId}/dismiss`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Dismissal failed.");
      }
      setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
      setState({ kind: "idle" });
      startTransition(() => router.refresh());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dismissal failed.";
      setState({ kind: "error", candidateId, message });
    }
  }

  if (candidates.length === 0) {
    return (
      <section className="wbeta-candidate-queue wbeta-candidate-queue-empty">
        <p>No pending memory candidates. Chat extractions land here for review.</p>
      </section>
    );
  }

  return (
    <section className="wbeta-candidate-queue">
      <header className="wbeta-candidate-queue-head">
        <h3>Pending memory candidates</h3>
        <span className="wbeta-candidate-queue-count">{candidates.length}</span>
      </header>
      <ul className="wbeta-candidate-queue-list">
        {candidates.map((c) => {
          const busy = isPending || (state.kind === "pending" && state.candidateId === c.id);
          const error = state.kind === "error" && state.candidateId === c.id ? state.message : null;
          return (
            <li key={c.id} className="wbeta-candidate-row">
              <div className="wbeta-candidate-meta">
                <span className={`wbeta-candidate-kind wbeta-candidate-kind-${c.kind}`}>
                  {KIND_LABEL[c.kind]}
                </span>
                <span className="wbeta-candidate-confidence">{(c.confidence * 100).toFixed(0)}%</span>
              </div>
              <pre className="wbeta-candidate-content">
                {typeof c.content === "string" ? c.content : JSON.stringify(c.content, null, 2)}
              </pre>
              <p className="wbeta-candidate-evidence">
                <span className="wbeta-candidate-evidence-label">Evidence:</span>
                <span className="wbeta-candidate-evidence-text">{c.evidence_excerpt}</span>
              </p>
              {c.source_conversation_id ? (
                <p className="wbeta-candidate-source">
                  Conversation:{" "}
                  <a href={`/workspace/chat/${c.source_conversation_id}`}>
                    {c.source_conversation_id.slice(0, 8)}
                  </a>
                </p>
              ) : null}
              {error ? <p className="wbeta-candidate-error">{error}</p> : null}
              <div className="wbeta-candidate-actions">
                <button
                  type="button"
                  className="wbeta-candidate-approve"
                  disabled={busy}
                  onClick={() => approve(c.id)}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="wbeta-candidate-dismiss"
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt("Reason for dismissing this candidate?");
                    if (reason && reason.trim().length > 0) {
                      void dismiss(c.id, reason.trim());
                    }
                  }}
                >
                  Dismiss
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
