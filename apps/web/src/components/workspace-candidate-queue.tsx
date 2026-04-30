"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { MemoryCandidateRow } from "@/lib/workspace/candidates";
import { formatCandidate } from "@/lib/workspace/format-candidates";

type Props = {
  initialCandidates: MemoryCandidateRow[];
  /**
   * Locale for rendering. Defaults to Italian since the analyst audience is
   * Italian-speaking. Pass "en" to render in English.
   */
  locale?: "en" | "it";
};

type ActionState =
  | { kind: "idle" }
  | { kind: "pending"; candidateId: string }
  | { kind: "error"; candidateId: string; message: string };

const KIND_LABEL_IT: Record<MemoryCandidateRow["kind"], string> = {
  fact: "Dato",
  rule: "Regola",
  preference: "Preferenza",
  alias: "Alias",
  entity: "Entità",
};

const KIND_LABEL_EN: Record<MemoryCandidateRow["kind"], string> = {
  fact: "Fact",
  rule: "Rule",
  preference: "Preference",
  alias: "Alias",
  entity: "Entity",
};

const COPY = {
  it: {
    title: "In attesa della tua conferma",
    subtitle: "Cose che Basquio ha estratto dalle conversazioni e vuole salvare in memoria. Approva quello che è giusto, scarta il resto.",
    empty: "Nessun candidato in coda. Quando Basquio estrae nuovi dati dalla chat, atterrano qui.",
    evidence: "Estratto da",
    conversation: "Conversazione",
    approve: "Salva in memoria",
    dismiss: "Scarta",
    dismissPrompt: "Perché lo scarti? (opzionale, una riga)",
    hotkeyHint: "J approva · K scarta",
    confidenceTooltip: (n: number) => `Confidenza ${n}%`,
  },
  en: {
    title: "Waiting on your confirmation",
    subtitle: "Items Basquio extracted from conversations. Approve what is right, dismiss the rest.",
    empty: "Queue is empty. New chat extractions land here for review.",
    evidence: "Extracted from",
    conversation: "Conversation",
    approve: "Save to memory",
    dismiss: "Dismiss",
    dismissPrompt: "Why dismiss this? (optional, one line)",
    hotkeyHint: "J approve · K dismiss",
    confidenceTooltip: (n: number) => `${n}% confidence`,
  },
} as const;

export function WorkspaceCandidateQueue({ initialCandidates, locale = "it" }: Props) {
  const router = useRouter();
  const [candidates, setCandidates] = useState(initialCandidates);
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const [focusIndex, setFocusIndex] = useState(0);

  const copy = COPY[locale];
  const kindLabel = locale === "it" ? KIND_LABEL_IT : KIND_LABEL_EN;

  const formatted = useMemo(
    () =>
      candidates.map((c) => ({
        row: c,
        rendered: formatCandidate({
          kind: c.kind,
          content: c.content,
          confidence: c.confidence,
          locale,
        }),
      })),
    [candidates, locale],
  );

  // Keep focus inside the list bounds when items are removed.
  useEffect(() => {
    if (focusIndex >= candidates.length) {
      setFocusIndex(Math.max(0, candidates.length - 1));
    }
  }, [candidates.length, focusIndex]);

  // J/K hotkeys: approve = J (or A), dismiss = K (or X). Cmd/Ctrl/Alt
  // modifiers are ignored so the shortcuts never collide with browser
  // shortcuts. Hotkeys only fire when no input/textarea has focus.
  useEffect(() => {
    function isInputFocused() {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || (el as HTMLElement).isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isInputFocused()) return;
      if (candidates.length === 0) return;
      const current = candidates[Math.min(focusIndex, candidates.length - 1)];
      if (!current) return;
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        void approve(current.id);
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        void dismiss(current.id, "");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((i) => Math.min(i + 1, candidates.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((i) => Math.max(i - 1, 0));
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, focusIndex]);

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
        throw new Error(payload.error ?? (locale === "it" ? "Salvataggio fallito." : "Approval failed."));
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
        body: JSON.stringify({ reason: reason || "user_dismissed" }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? (locale === "it" ? "Scarto fallito." : "Dismissal failed."));
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
        <p>{copy.empty}</p>
      </section>
    );
  }

  return (
    <section className="wbeta-candidate-queue">
      <header className="wbeta-candidate-queue-head">
        <div>
          <h3 className="wbeta-candidate-queue-title">{copy.title}</h3>
          <p className="wbeta-candidate-queue-sub">{copy.subtitle}</p>
        </div>
        <div className="wbeta-candidate-queue-meta">
          <span className="wbeta-candidate-queue-count">{candidates.length}</span>
          <span className="wbeta-candidate-queue-hotkey">{copy.hotkeyHint}</span>
        </div>
      </header>
      <ul className="wbeta-candidate-queue-list" role="list">
        {formatted.map(({ row, rendered }, idx) => {
          const busy = isPending || (state.kind === "pending" && state.candidateId === row.id);
          const error = state.kind === "error" && state.candidateId === row.id ? state.message : null;
          const focused = idx === focusIndex;
          return (
            <li
              key={row.id}
              className={
                focused ? "wbeta-candidate-row wbeta-candidate-row-focused" : "wbeta-candidate-row"
              }
              data-candidate-kind={row.kind}
              onMouseEnter={() => setFocusIndex(idx)}
            >
              <div className="wbeta-candidate-row-head">
                <span className={`wbeta-candidate-kind wbeta-candidate-kind-${row.kind}`}>
                  {kindLabel[row.kind]}
                </span>
                <span
                  className="wbeta-candidate-confidence"
                  title={copy.confidenceTooltip(rendered.confidencePercent)}
                  aria-label={copy.confidenceTooltip(rendered.confidencePercent)}
                >
                  {rendered.confidenceLabel}
                </span>
              </div>
              <p className="wbeta-candidate-headline">{rendered.headline}</p>
              {rendered.detail ? (
                <p className="wbeta-candidate-detail">{rendered.detail}</p>
              ) : null}
              {row.evidence_excerpt ? (
                <p className="wbeta-candidate-evidence">
                  <span className="wbeta-candidate-evidence-label">{copy.evidence}:</span>{" "}
                  <span className="wbeta-candidate-evidence-text">&quot;{row.evidence_excerpt}&quot;</span>
                </p>
              ) : null}
              {row.source_conversation_id ? (
                <p className="wbeta-candidate-source">
                  {copy.conversation}:{" "}
                  <a href={`/workspace/chat/${row.source_conversation_id}`}>
                    {row.source_conversation_id.slice(0, 8)}
                  </a>
                </p>
              ) : null}
              {error ? <p className="wbeta-candidate-error">{error}</p> : null}
              <div className="wbeta-candidate-actions">
                <button
                  type="button"
                  className="wbeta-candidate-approve"
                  disabled={busy}
                  onClick={() => approve(row.id)}
                >
                  {copy.approve}
                </button>
                <button
                  type="button"
                  className="wbeta-candidate-dismiss"
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt(copy.dismissPrompt) ?? "";
                    void dismiss(row.id, reason.trim());
                  }}
                >
                  {copy.dismiss}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
