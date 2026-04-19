"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { WorkspaceAnswerCard, type AnswerView } from "@/components/workspace-answer-card";

export function WorkspacePrompt() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
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
        body: JSON.stringify({ prompt: prompt.trim() }),
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
        scope: data.scope ?? "workspace",
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
        <label className="wbeta-prompt-label" htmlFor="wbeta-prompt-input">
          Ask anything
        </label>
        <textarea
          id="wbeta-prompt-input"
          className="wbeta-prompt-input wbeta-prompt-textarea"
          placeholder="Write the Q1 narrative for Kellanova Snack Salati. Or anything else."
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
          <p className="wbeta-prompt-hint">
            {isSubmitting
              ? "Thinking. Pulling entities, facts, memory, and source excerpts."
              : "Cmd+Enter to send. Every claim is grounded in your uploads."}
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
