"use client";

import { useEffect, useState } from "react";

export function WorkspaceShortcuts() {
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      const isCmd = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const inEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (isCmd && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const input =
          (document.getElementById("wbeta-ai-input") as HTMLTextAreaElement | null) ??
          (document.getElementById("wbeta-prompt-input") as HTMLTextAreaElement | null);
        input?.focus();
        input?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (isCmd && event.key.toLowerCase() === "u") {
        event.preventDefault();
        const drop = document.querySelector(
          ".wbeta-drop input[type=file]",
        ) as HTMLInputElement | null;
        drop?.click();
        return;
      }
      if (isCmd && event.key === "/") {
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }
      if (event.key === "Escape" && helpOpen && !inEditable) {
        event.preventDefault();
        setHelpOpen(false);
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [helpOpen]);

  if (!helpOpen) return null;

  return (
    <div className="wbeta-shortcuts-backdrop" onClick={() => setHelpOpen(false)} role="presentation">
      <div
        className="wbeta-shortcuts-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wbeta-shortcuts-title-h"
      >
        <h3 id="wbeta-shortcuts-title-h" className="wbeta-shortcuts-title">
          Keyboard shortcuts
        </h3>
        <ul className="wbeta-shortcuts-list">
          <li>
            <kbd>⌘ K</kbd>
            <span>Focus the ask anything input.</span>
          </li>
          <li>
            <kbd>⌘ U</kbd>
            <span>Open the file picker.</span>
          </li>
          <li>
            <kbd>⌘ Enter</kbd>
            <span>Send the prompt.</span>
          </li>
          <li>
            <kbd>Esc</kbd>
            <span>Close any panel.</span>
          </li>
          <li>
            <kbd>⌘ /</kbd>
            <span>Toggle this panel.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
