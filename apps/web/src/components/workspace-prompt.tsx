"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { WorkspaceAnswerCard, type AnswerView } from "@/components/workspace-answer-card";

export function WorkspacePrompt({
  scopes,
  defaultScope,
}: {
  scopes: string[];
  defaultScope: string;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [scope, setScope] = useState(defaultScope);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [answer, setAnswer] = useState<AnswerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim() || isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    setAnswer(null);

    try {
      const response = await fetch("/api/workspace/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), scope }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        deliverableId?: string;
        bodyMarkdown?: string;
        citations?: AnswerView["citations"];
        scope?: string;
        error?: string;
      };
      if (!response.ok) {
        setError(data.error ?? "Generation failed.");
        return;
      }
      setAnswer({
        deliverableId: data.deliverableId ?? "",
        bodyMarkdown: data.bodyMarkdown ?? "",
        citations: data.citations ?? [],
        scope: data.scope ?? scope,
        prompt: prompt.trim(),
      });
      setPrompt("");
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="wbeta-prompt-shell">
      <form className="wbeta-prompt-form" onSubmit={handleSubmit}>
        <div className="wbeta-prompt-headrow">
          <label className="wbeta-prompt-label" htmlFor="wbeta-prompt-input">
            Ask anything
          </label>
          <div className="wbeta-prompt-scope">
            <label className="wbeta-prompt-scope-label" htmlFor="wbeta-scope-select">
              Scope
            </label>
            <select
              id="wbeta-scope-select"
              className="wbeta-prompt-scope-select"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              disabled={isSubmitting}
              aria-describedby="wbeta-scope-hint"
              title="Limit retrieval and memory to this slice of the workspace"
            >
              {scopes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <textarea
          id="wbeta-prompt-input"
          className="wbeta-prompt-input wbeta-prompt-textarea"
          placeholder="Ask a question or describe a deliverable. Example: what changed in Q4 vs Q3 and why."
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          rows={3}
          disabled={isSubmitting}
        />
        <div className="wbeta-prompt-row">
          <p className="wbeta-prompt-hint" id="wbeta-scope-hint">
            {isSubmitting
              ? "Generating. This usually finishes in 15 to 30 seconds."
              : "Cmd+Enter to send. Cmd+/ for shortcuts. Every claim cites a source from your uploads."}
          </p>
          <button
            type="submit"
            className="wbeta-prompt-submit"
            disabled={isSubmitting || prompt.trim().length === 0}
          >
            {isSubmitting ? "Generating..." : "Send"}
          </button>
        </div>
      </form>

      {error ? <p className="wbeta-prompt-error">{error}</p> : null}

      {answer ? <WorkspaceAnswerCard answer={answer} /> : null}
    </div>
  );
}
