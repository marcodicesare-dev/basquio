"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  WorkspaceAnswerCard,
  type AnswerView,
  type CitationView,
} from "@/components/workspace-answer-card";

function RetryDeliverableButton({ deliverableId }: { deliverableId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/deliverables/${deliverableId}/retry`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as {
        deliverableId?: string;
        error?: string;
      };
      if (!response.ok) {
        setError(data.error ?? "Retry failed.");
        return;
      }
      if (data.deliverableId) {
        router.push(`/workspace/deliverable/${data.deliverableId}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="wbeta-deliverable-edit-btn"
        onClick={handleClick}
        aria-busy={busy}
        data-loading={busy ? "true" : undefined}
        disabled={busy}
      >
        {busy ? "Retrying..." : "Retry"}
      </button>
      {error ? <p className="wbeta-deliverable-error">{error}</p> : null}
    </>
  );
}

type Status = "generating" | "ready" | "failed" | "archived";

export function WorkspaceDeliverableView({
  deliverableId,
  bodyMarkdown,
  citations,
  status,
  scope,
}: {
  deliverableId: string;
  bodyMarkdown: string;
  citations: CitationView[];
  status: Status;
  scope: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bodyMarkdown);
  const [savedBody, setSavedBody] = useState(bodyMarkdown);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordPreference, setRecordPreference] = useState(true);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (status !== "generating") return;
    const id = window.setInterval(() => router.refresh(), 4000);
    return () => window.clearInterval(id);
  }, [status, router]);

  useEffect(() => {
    setDraft(bodyMarkdown);
    setSavedBody(bodyMarkdown);
  }, [bodyMarkdown]);

  const answer: AnswerView = useMemo(
    () => ({
      deliverableId,
      bodyMarkdown: savedBody,
      citations,
      scope: scope ?? "workspace",
      prompt: "",
    }),
    [deliverableId, savedBody, citations, scope],
  );

  if (status === "generating") {
    return (
      <div className="wbeta-deliverable-state">
        <p className="wbeta-deliverable-state-title">Generating your answer.</p>
        <p className="wbeta-deliverable-state-body">
          This usually finishes in 15 to 30 seconds. The page refreshes itself when ready.
        </p>
      </div>
    );
  }

  if (status === "failed" && !savedBody) {
    return (
      <div className="wbeta-deliverable-state wbeta-deliverable-state-err">
        <p className="wbeta-deliverable-state-title">Generation failed.</p>
        <p className="wbeta-deliverable-state-body">
          Retry runs the same prompt again with the latest workspace context.
        </p>
        <RetryDeliverableButton deliverableId={deliverableId} />
      </div>
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/deliverables/${deliverableId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body_markdown: draft,
          record_preference: recordPreference,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        savedAt?: string;
      };
      if (!response.ok) {
        setError(data.error ?? "Save failed.");
        return;
      }
      setSavedBody(draft);
      setSavedAt(data.savedAt ?? new Date().toISOString());
      setEditing(false);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setDraft(savedBody);
    setEditing(false);
    setError(null);
  }

  return (
    <div className="wbeta-deliverable-body">
      {!editing ? (
        <div className="wbeta-deliverable-actions">
          {savedAt ? <span className="wbeta-deliverable-saved">Saved.</span> : null}
          <a
            href={`/jobs/new?deliverable=${deliverableId}`}
            className="wbeta-deliverable-edit-btn wbeta-deliverable-deck-btn"
          >
            Generate deck
          </a>
          <button
            type="button"
            className="wbeta-deliverable-edit-btn"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        </div>
      ) : null}

      {!editing ? (
        <WorkspaceAnswerCard answer={answer} />
      ) : (
        <div className="wbeta-deliverable-editor">
          <textarea
            className="wbeta-deliverable-textarea"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={saving}
            spellCheck={false}
          />

          <label className="wbeta-deliverable-pref">
            <input
              type="checkbox"
              checked={recordPreference}
              onChange={(event) => setRecordPreference(event.target.checked)}
              disabled={saving}
            />
            Remember this edit as a preference for next time.
          </label>

          {error ? <p className="wbeta-deliverable-error">{error}</p> : null}

          <div className="wbeta-deliverable-editor-actions">
            <button
              type="button"
              className="wbeta-deliverable-cancel-btn"
              onClick={handleCancel}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="wbeta-prompt-submit"
              onClick={handleSave}
              aria-busy={saving}
              data-loading={saving ? "true" : undefined}
              disabled={saving || draft === savedBody}
            >
              {saving ? "Saving..." : "Save edits"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
