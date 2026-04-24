"use client";

import { ArrowRight } from "@phosphor-icons/react";

export function WorkspaceHomePromptAction({ prompt }: { prompt: string }) {
  return (
    <button
      type="button"
      className="wbeta-home-suggestion-action"
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent("basquio:workspace-prompt", {
            detail: { prompt },
          }),
        );
        document.getElementById("workspace-chat")?.scrollIntoView({
          block: "start",
          behavior: "smooth",
        });
      }}
    >
      <span>Use in chat</span>
      <ArrowRight size={12} weight="bold" />
    </button>
  );
}
