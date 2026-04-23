import { beforeEach, describe, expect, it } from "vitest";

import type { EntityExtractionResult } from "./extraction";
import {
  clearExtractionCache,
  deleteExtractionCacheEntry,
  extractionCacheSize,
  getExtractionCacheEntry,
  putExtractionCacheEntry,
} from "./extraction-cache";

function sampleResult(): EntityExtractionResult {
  return {
    entities: [
      {
        type: "person",
        canonical_name: "Maria Rossi",
        aliases: ["Maria"],
        role: "Head of Insights, Kellanova",
      },
    ],
    facts: [
      {
        subject_canonical_name: "Maria Rossi",
        subject_type: "person",
        predicate: "works_at",
        object_value: "Kellanova Italia",
        confidence: 0.9,
      },
    ],
  };
}

describe("extraction cache", () => {
  beforeEach(() => {
    clearExtractionCache();
  });

  it("round-trips an entry within TTL", () => {
    const t0 = 1_000_000;
    const entry = putExtractionCacheEntry({
      workspaceId: "w1",
      scopeId: "s1",
      text: "some paste",
      sourceHint: "chat_paste",
      sourceLabel: "Email from Maria",
      conversationId: "c1",
      sourceUrl: null,
      result: sampleResult(),
      now: t0,
    });
    const hit = getExtractionCacheEntry(entry.extractionId, { now: t0 + 1000 });
    expect(hit).not.toBeNull();
    expect(hit?.text).toBe("some paste");
    expect(hit?.result.entities.length).toBe(1);
  });

  it("returns null for a missing id", () => {
    expect(getExtractionCacheEntry("not-a-real-id")).toBeNull();
  });

  it("expires entries after the 5-minute TTL", () => {
    const t0 = 2_000_000;
    const entry = putExtractionCacheEntry({
      workspaceId: "w1",
      scopeId: null,
      text: "paste",
      sourceHint: "chat_paste",
      sourceLabel: null,
      conversationId: null,
      sourceUrl: null,
      result: sampleResult(),
      now: t0,
    });
    const justBefore = getExtractionCacheEntry(entry.extractionId, {
      now: t0 + 5 * 60 * 1000,
    });
    expect(justBefore).not.toBeNull();
    const justAfter = getExtractionCacheEntry(entry.extractionId, {
      now: t0 + 5 * 60 * 1000 + 1,
    });
    expect(justAfter).toBeNull();
  });

  it("delete removes a cached entry", () => {
    const entry = putExtractionCacheEntry({
      workspaceId: "w1",
      scopeId: null,
      text: "x",
      sourceHint: "chat_paste",
      sourceLabel: null,
      conversationId: null,
      sourceUrl: null,
      result: sampleResult(),
    });
    expect(deleteExtractionCacheEntry(entry.extractionId)).toBe(true);
    expect(getExtractionCacheEntry(entry.extractionId)).toBeNull();
    expect(deleteExtractionCacheEntry(entry.extractionId)).toBe(false);
  });

  it("evicts oldest entries when the cap is exceeded", () => {
    const total = 205;
    const base = 3_000_000;
    for (let i = 0; i < total; i += 1) {
      putExtractionCacheEntry({
        extractionId: `id-${i}`,
        workspaceId: "w",
        scopeId: null,
        text: `paste ${i}`,
        sourceHint: "chat_paste",
        sourceLabel: null,
        conversationId: null,
        sourceUrl: null,
        result: sampleResult(),
        now: base + i,
      });
    }
    expect(extractionCacheSize()).toBe(200);
    // Oldest (id-0 through id-4) evicted; newest (id-204) kept.
    // Pin `now` to the last put time so the TTL does not trip under
    // real-clock drift on a slow CI runner.
    const probeNow = base + total;
    expect(getExtractionCacheEntry("id-0", { now: probeNow })).toBeNull();
    expect(getExtractionCacheEntry("id-4", { now: probeNow })).toBeNull();
    expect(getExtractionCacheEntry("id-204", { now: probeNow })).not.toBeNull();
  });

  it("generates a fresh id when one is not provided", () => {
    const e1 = putExtractionCacheEntry({
      workspaceId: "w",
      scopeId: null,
      text: "a",
      sourceHint: "chat_paste",
      sourceLabel: null,
      conversationId: null,
      sourceUrl: null,
      result: sampleResult(),
    });
    const e2 = putExtractionCacheEntry({
      workspaceId: "w",
      scopeId: null,
      text: "b",
      sourceHint: "chat_paste",
      sourceLabel: null,
      conversationId: null,
      sourceUrl: null,
      result: sampleResult(),
    });
    expect(e1.extractionId).not.toBe(e2.extractionId);
    expect(e1.extractionId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
