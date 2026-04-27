"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { AnticipationHint } from "@/lib/workspace/types";

type Props = {
  hints: AnticipationHint[];
};

type ActionState =
  | { kind: "idle" }
  | { kind: "pending"; hintId: string }
  | { kind: "error"; hintId: string; message: string };

const KIND_LABEL: Record<AnticipationHint["kind"], string> = {
  reactive: "Reactive",
  proactive: "Proactive",
  optimisation: "Optimisation",
};

export function WorkspaceHintsBanner({ hints }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(hints);
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const [, startTransition] = useTransition();

  // Empty state: render a quiet card so the surface is discoverable on
  // first sign-in. Generators are pull-based today (Brief 5 PART C);
  // hints land here when a workspace accumulates pending candidates,
  // a brand book is extracted, or rules churn in a 14-day window.
  if (items.length === 0) {
    return (
      <section className="wbeta-hints-banner wbeta-hints-banner-empty">
        <header>
          <h3>This week</h3>
          <span className="wbeta-hints-count">nothing pressing</span>
        </header>
        <p className="wbeta-hints-empty-copy">
          When something needs your attention (a stale claim in a draft, a brand book ready
          to review, a pattern of corrections worth pinning), it lands here.
        </p>
      </section>
    );
  }

  async function callAction(hintId: string, action: "dismiss" | "snooze" | "accept") {
    setState({ kind: "pending", hintId });
    try {
      const response = await fetch(`/api/workspace/hints/${hintId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: action === "snooze" ? JSON.stringify({ days: 7 }) : undefined,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `${action} failed`);
      }
      setItems((prev) => prev.filter((h) => h.id !== hintId));
      setState({ kind: "idle" });
      startTransition(() => router.refresh());
    } catch (error) {
      const message = error instanceof Error ? error.message : `${action} failed`;
      setState({ kind: "error", hintId, message });
    }
  }

  function actionHref(hint: AnticipationHint): string | null {
    const target = hint.target_action as { kind?: string; payload?: { href?: string } } | null;
    if (target?.kind === "open_route" && typeof target.payload?.href === "string") {
      return target.payload.href;
    }
    return null;
  }

  return (
    <section className="wbeta-hints-banner">
      <header>
        <h3>This week</h3>
        <span className="wbeta-hints-count">{items.length} {items.length === 1 ? "thing" : "things"}</span>
      </header>
      <ul>
        {items.map((h) => {
          const busy = state.kind === "pending" && state.hintId === h.id;
          const error = state.kind === "error" && state.hintId === h.id ? state.message : null;
          const href = actionHref(h);
          return (
            <li key={h.id} className={`wbeta-hint wbeta-hint-${h.kind}`}>
              <span className="wbeta-hint-kind">{KIND_LABEL[h.kind]}</span>
              <p className="wbeta-hint-title">{h.title}</p>
              <p className="wbeta-hint-reason">{h.reason}</p>
              {error ? <p className="wbeta-hint-error">{error}</p> : null}
              <div className="wbeta-hint-actions">
                {href ? (
                  <a className="wbeta-hint-open" href={href}>
                    Open
                  </a>
                ) : null}
                <button type="button" disabled={busy} onClick={() => callAction(h.id, "accept")}>
                  Done
                </button>
                <button type="button" disabled={busy} onClick={() => callAction(h.id, "snooze")}>
                  Snooze 7d
                </button>
                <button type="button" disabled={busy} onClick={() => callAction(h.id, "dismiss")}>
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
