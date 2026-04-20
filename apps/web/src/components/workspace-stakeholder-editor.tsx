"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";

import type { StakeholderPreferences } from "@/lib/workspace/people-types";

type StructuredPrefs = NonNullable<StakeholderPreferences["structured"]>;

type EditorState = {
  role: string;
  company: string;
  preferences: StakeholderPreferences;
  notes: string;
};

const PREF_FIELDS: Array<{
  key: keyof StructuredPrefs;
  label: string;
  placeholder: string;
  help: string;
}> = [
  {
    key: "chart_preference",
    label: "Chart preference",
    placeholder: "e.g., waterfall over bar for competitive decomposition",
    help: "How this person likes to see data visualized.",
  },
  {
    key: "deck_length",
    label: "Deck length",
    placeholder: "e.g., 8-12 slides max for steerco",
    help: "Their default depth preference.",
  },
  {
    key: "language",
    label: "Language",
    placeholder: "e.g., Italian for internal, English for cross-market",
    help: "Which language answers should default to.",
  },
  {
    key: "tone",
    label: "Tone",
    placeholder: "e.g., direct, headline-first, no hedging",
    help: "The register they expect in writing.",
  },
  {
    key: "review_day",
    label: "Review cadence",
    placeholder: "e.g., prefers drafts by Wednesday EOD",
    help: "Timing rhythms worth knowing.",
  },
];

export function StakeholderProfileEditor({
  personId,
  initial,
}: {
  personId: string;
  initial: EditorState;
}) {
  const router = useRouter();
  const [state, setState] = useState<EditorState>(initial);
  const [saved, setSaved] = useState<EditorState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<"saved" | null>(null);

  const structured: StructuredPrefs = {
    ...(state.preferences.structured ?? {}),
  };

  function updateStructured(key: keyof StructuredPrefs, value: string) {
    const next: StructuredPrefs = { ...structured };
    const trimmed = value.trim();
    if (trimmed === "") {
      delete next[key];
    } else {
      next[key] = value;
    }
    setState((prev) => ({
      ...prev,
      preferences: { ...prev.preferences, structured: next },
    }));
  }

  function updateFreeText(value: string) {
    setState((prev) => ({
      ...prev,
      preferences: { ...prev.preferences, free_text: value },
    }));
  }

  const dirty = JSON.stringify(state) !== JSON.stringify(saved);

  async function save() {
    if (!dirty || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/people/${personId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: state.role,
          company: state.company,
          preferences: state.preferences,
          notes: state.notes,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not save.");
      }
      setSaved(state);
      setFlash("saved");
      router.refresh();
      setTimeout(() => setFlash(null), 1800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setState(saved);
    setError(null);
  }

  return (
    <section className="wbeta-stakeholder-editor">
      <header className="wbeta-stakeholder-editor-head">
        <div>
          <h2 className="wbeta-stakeholder-editor-title">Profile</h2>
          <p className="wbeta-stakeholder-editor-hint">
            Preferences captured here inform every answer that cites this stakeholder.
          </p>
        </div>
        <div className="wbeta-stakeholder-editor-status" aria-live="polite">
          {flash === "saved" ? (
            <span className="wbeta-stakeholder-editor-flash">
              <CheckCircle size={13} weight="fill" /> Saved
            </span>
          ) : null}
          {error ? (
            <span className="wbeta-stakeholder-editor-error">
              <WarningCircle size={13} weight="fill" /> {error}
            </span>
          ) : null}
        </div>
      </header>

      <div className="wbeta-stakeholder-editor-grid">
        <label className="wbeta-stakeholder-field">
          <span>Role</span>
          <input
            type="text"
            value={state.role}
            onChange={(e) => setState((p) => ({ ...p, role: e.target.value }))}
            placeholder="e.g., Category Insights Manager"
            maxLength={200}
          />
        </label>
        <label className="wbeta-stakeholder-field">
          <span>Company</span>
          <input
            type="text"
            value={state.company}
            onChange={(e) => setState((p) => ({ ...p, company: e.target.value }))}
            placeholder="e.g., Mulino Bianco"
            maxLength={200}
          />
        </label>
      </div>

      <div className="wbeta-stakeholder-preferences">
        <div className="wbeta-stakeholder-preferences-head">
          <h3 className="wbeta-stakeholder-preferences-title">Preferences</h3>
          <p className="wbeta-stakeholder-preferences-hint">
            Every field here changes how Basquio answers questions tied to this person.
          </p>
        </div>
        <div className="wbeta-stakeholder-preferences-grid">
          {PREF_FIELDS.map((field) => (
            <label key={field.key} className="wbeta-stakeholder-field">
              <span>{field.label}</span>
              <input
                type="text"
                value={String(structured[field.key] ?? "")}
                onChange={(e) => updateStructured(field.key, e.target.value)}
                placeholder={field.placeholder}
                maxLength={400}
              />
              <em className="wbeta-stakeholder-field-help">{field.help}</em>
            </label>
          ))}
        </div>
      </div>

      <label className="wbeta-stakeholder-field wbeta-stakeholder-field-wide">
        <span>Free-text preferences</span>
        <textarea
          value={state.preferences.free_text ?? ""}
          onChange={(e) => updateFreeText(e.target.value)}
          rows={3}
          placeholder="Anything subtle that doesn't fit a field. Basquio will read this verbatim."
          maxLength={4000}
        />
      </label>

      <label className="wbeta-stakeholder-field wbeta-stakeholder-field-wide">
        <span>Notes (private)</span>
        <textarea
          value={state.notes}
          onChange={(e) => setState((p) => ({ ...p, notes: e.target.value }))}
          rows={3}
          placeholder="Reminders for yourself. Not cited in answers."
          maxLength={4000}
        />
      </label>

      <footer className="wbeta-stakeholder-editor-foot">
        <button
          type="button"
          className="wbeta-stakeholder-editor-cancel"
          onClick={reset}
          disabled={!dirty || busy}
        >
          Discard changes
        </button>
        <button
          type="button"
          className="wbeta-stakeholder-editor-save"
          onClick={save}
          disabled={!dirty || busy}
        >
          {busy ? "Saving…" : "Save profile"}
        </button>
      </footer>
    </section>
  );
}
