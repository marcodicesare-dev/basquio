"use client";

import type { GenerationRequest } from "@basquio/types";

type SourceFileDraft = NonNullable<GenerationRequest["sourceFiles"]>[number];

export type RunLaunchDraft = {
  runId: string;
  createdAt: string;
  authorModel: string;
  templateProfileId: string | null;
  targetSlideCount: number;
  recipeId?: string;
  brief: {
    businessContext: string;
    client: string;
    audience: string;
    objective: string;
    thesis: string;
    stakes: string;
  };
  sourceFiles?: SourceFileDraft[];
  existingSourceFileIds?: string[];
};

function getStorageKey(runId: string) {
  return `basquio:run-launch:${runId}`;
}

function getLaunchStateKey(runId: string) {
  return `basquio:run-launch-state:${runId}`;
}

export function saveRunLaunchDraft(draft: RunLaunchDraft) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(getStorageKey(draft.runId), JSON.stringify(draft));
}

export function readRunLaunchDraft(runId: string): RunLaunchDraft | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(getStorageKey(runId));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as RunLaunchDraft;
  } catch {
    window.sessionStorage.removeItem(getStorageKey(runId));
    return null;
  }
}

export function clearRunLaunchDraft(runId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(getStorageKey(runId));
  clearRunLaunchState(runId);
}

export function readRunLaunchState(runId: string): "pending" | "accepted" | "needs_credits" | null {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.sessionStorage.getItem(getLaunchStateKey(runId));
  return value === "pending" || value === "accepted" || value === "needs_credits" ? value : null;
}

export function saveRunLaunchState(runId: string, state: "pending" | "accepted" | "needs_credits") {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(getLaunchStateKey(runId), state);
}

export function clearRunLaunchState(runId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(getLaunchStateKey(runId));
}
