"use client";

import { useState } from "react";

import type { WorkspaceSuggestion } from "@/lib/workspace/suggestions";

const KIND_LABELS: Record<WorkspaceSuggestion["kind"], string> = {
  summarize: "Summarize",
  investigate: "Investigate",
  narrate: "Narrate",
  retry: "Retry",
};

export function WorkspaceSuggestions({
  initialSuggestions,
}: {
  initialSuggestions: WorkspaceSuggestion[];
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = initialSuggestions.filter((s) => !dismissed.has(s.id));

  if (visible.length === 0) return null;

  function fillPrompt(prompt: string) {
    const input = document.getElementById("wbeta-prompt-input") as HTMLTextAreaElement | null;
    if (!input) return;
    input.value = prompt;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    input.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="wbeta-suggestions">
      <p className="wbeta-suggestions-head">Try this</p>
      <ul className="wbeta-suggestions-list">
        {visible.map((suggestion) => (
          <li key={suggestion.id} className="wbeta-suggestions-item">
            <div className="wbeta-suggestions-item-main">
              <div className="wbeta-suggestions-row">
                <span className={`wbeta-suggestions-kind wbeta-suggestions-kind-${suggestion.kind}`}>
                  {KIND_LABELS[suggestion.kind]}
                </span>
                <p className="wbeta-suggestions-prompt">{suggestion.prompt}</p>
              </div>
              <p className="wbeta-suggestions-reason">{suggestion.reason}</p>
            </div>
            <div className="wbeta-suggestions-actions">
              <button
                type="button"
                className="wbeta-suggestions-cta"
                onClick={() => fillPrompt(suggestion.prompt)}
              >
                Use
              </button>
              <button
                type="button"
                className="wbeta-suggestions-dismiss"
                onClick={() => setDismissed((prev) => new Set(prev).add(suggestion.id))}
                aria-label="Dismiss suggestion"
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
