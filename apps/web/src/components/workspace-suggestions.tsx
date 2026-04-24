"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, X } from "@phosphor-icons/react";

import type { WorkspaceSuggestion } from "@/lib/workspace/suggestions";

const KIND_LABELS: Record<WorkspaceSuggestion["kind"], string> = {
  summarize: "Summarize",
  investigate: "Investigate",
  narrate: "Narrate",
  retry: "Retry",
};

const DISMISS_KEY = "basquio:dismissed-suggestions:v1";
const DISMISS_TTL = 7 * 24 * 60 * 60 * 1000;

type SuggestionPlacement = "home" | "scope" | "inline";

export function WorkspaceSuggestionSurface({
  title,
  countLabel,
  suggestions,
  placement,
}: {
  title: string;
  countLabel?: string;
  suggestions: WorkspaceSuggestion[];
  placement: Exclude<SuggestionPlacement, "inline">;
}) {
  const { visible, dismiss, sendPrompt } = useDismissibleSuggestions(suggestions);

  if (visible.length === 0) return null;

  return (
    <section
      className={`wbeta-suggestion-surface wbeta-suggestion-surface-${placement}`}
      aria-labelledby={`wbeta-suggestion-title-${placement}`}
    >
      <div className="wbeta-suggestion-surface-head">
        <h2 id={`wbeta-suggestion-title-${placement}`}>{title}</h2>
        {countLabel ? <span>{countLabel}</span> : null}
      </div>
      <div className="wbeta-suggestion-grid">
        {visible.slice(0, 3).map((suggestion) => (
          <article key={suggestion.id} className="wbeta-suggestion-card">
            <div className="wbeta-suggestion-card-body">
              <span className={`wbeta-suggestion-kind wbeta-suggestion-kind-${suggestion.kind}`}>
                {KIND_LABELS[suggestion.kind]}
              </span>
              <h3>{suggestion.prompt}</h3>
              <p>{suggestion.reason}</p>
            </div>
            <div className="wbeta-suggestion-card-actions">
              <button
                type="button"
                className="wbeta-suggestion-action"
                onClick={() => sendPrompt(suggestion)}
              >
                <span>{suggestion.ctaLabel ?? "Use in chat"}</span>
                <ArrowRight size={12} weight="bold" />
              </button>
              <button
                type="button"
                className="wbeta-suggestion-dismiss"
                onClick={() => dismiss(suggestion.id)}
                aria-label={`Dismiss ${suggestion.prompt}`}
              >
                <X size={12} weight="bold" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function WorkspaceInlineSuggestions({
  suggestions,
  onSend,
}: {
  suggestions: WorkspaceSuggestion[];
  onSend?: (prompt: string) => void;
}) {
  const [used, setUsed] = useState(false);
  const { visible, dismiss } = useDismissibleSuggestions(suggestions);
  const chips = visible.slice(0, 3);

  if (used || chips.length === 0 || !onSend) return null;

  return (
    <div className="wbeta-inline-suggestions" aria-label="Suggested next actions">
      <p>You might also want to:</p>
      <div className="wbeta-inline-suggestion-row">
        {chips.map((suggestion) => (
          <button
            key={suggestion.id}
            type="button"
            className="wbeta-inline-suggestion-chip"
            onClick={() => {
              setUsed(true);
              dismiss(suggestion.id);
              onSend(suggestion.prompt);
            }}
          >
            {compactPrompt(suggestion.prompt)}
          </button>
        ))}
      </div>
    </div>
  );
}

function useDismissibleSuggestions(suggestions: WorkspaceSuggestion[]) {
  const [dismissed, setDismissed] = useState<Record<string, number>>({});

  useEffect(() => {
    const now = Date.now();
    const parsed = readDismissed();
    const fresh = Object.fromEntries(
      Object.entries(parsed).filter(([, timestamp]) => now - timestamp < DISMISS_TTL),
    );
    setDismissed(fresh);
    writeDismissed(fresh);
  }, []);

  const visible = useMemo(
    () => suggestions.filter((suggestion) => !dismissed[suggestion.id]).slice(0, 3),
    [dismissed, suggestions],
  );

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = { ...prev, [id]: Date.now() };
      writeDismissed(next);
      return next;
    });
  }

  function sendPrompt(suggestion: WorkspaceSuggestion) {
    window.dispatchEvent(
      new CustomEvent("basquio:workspace-prompt", {
        detail: { prompt: suggestion.prompt },
      }),
    );
    document.getElementById("workspace-chat")?.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
  }

  return { visible, dismiss, sendPrompt };
}

function readDismissed(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISMISS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
    );
  } catch {
    return {};
  }
}

function writeDismissed(value: Record<string, number>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DISMISS_KEY, JSON.stringify(value));
}

function compactPrompt(prompt: string) {
  return prompt.length > 42 ? `${prompt.slice(0, 39).trim()}…` : prompt;
}
