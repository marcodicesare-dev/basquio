import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObjectMock = vi.hoisted(() => vi.fn());

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, generateObject: generateObjectMock };
});

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (modelId: string) => ({ modelId }),
}));

beforeEach(() => {
  generateObjectMock.mockReset();
  delete process.env.CHAT_EXTRACTOR_ENABLED;
});

function buildFakeSupabase() {
  const calls: { rpc: Array<[string, Record<string, unknown>]>; insert: unknown[]; update: unknown[]; upsert: unknown[] } = {
    rpc: [],
    insert: [],
    update: [],
    upsert: [],
  };
  const ensuredWorkflowId = "11111111-1111-1111-1111-111111111111";
  const runId = "22222222-2222-2222-2222-222222222222";
  const fakeFrom = vi.fn((table: string) => {
    if (table === "memory_workflows") {
      return {
        upsert: (row: unknown) => {
          calls.upsert.push(row);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: ensuredWorkflowId }, error: null }),
            }),
          };
        },
      };
    }
    if (table === "memory_workflow_runs") {
      return {
        insert: (row: unknown) => {
          calls.insert.push(row);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: runId }, error: null }),
            }),
          };
        },
        update: (row: unknown) => {
          calls.update.push(row);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  const fakeRpc = vi.fn((name: string, params: Record<string, unknown>) => {
    calls.rpc.push([name, params]);
    return Promise.resolve({ data: name === "auto_promote_high_confidence" ? { kind: "fact", durable_id: "f-id" } : "c-id", error: null });
  });
  return { from: fakeFrom, rpc: fakeRpc, calls, runId };
}

const baseInput = {
  conversationId: "11111111-aaaa-bbbb-cccc-000000000001",
  turnText: "Lavazza launched Eraclea in March 2024 as their first cold-brew SKU.",
  recentTurns: "user: previous talk\nassistant: ok",
  workspaceId: "11111111-aaaa-bbbb-cccc-000000000001",
  organizationId: "11111111-aaaa-bbbb-cccc-000000000001",
  scopeId: null,
  userId: "user-uuid",
  sourceMessageId: null,
};

describe("extractCandidatesFromTurn", () => {
  it("returns empty result and writes no rows on a sub-10-char turn", async () => {
    const { extractCandidatesFromTurn } = await import("./chat-extraction");
    const supabase = buildFakeSupabase();
    const result = await extractCandidatesFromTurn(supabase as never, { ...baseInput, turnText: "ok" });
    expect(result.candidatesCreated).toBe(0);
    expect(result.autoPromoted).toBe(0);
    expect(supabase.calls.rpc).toHaveLength(0);
    expect(supabase.calls.insert).toHaveLength(0);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("drops candidates below 0.6 confidence", async () => {
    const { extractCandidatesFromTurn } = await import("./chat-extraction");
    generateObjectMock.mockResolvedValueOnce({
      object: {
        candidates: [
          {
            kind: "fact",
            content: { predicate: "maybe", subject_entity_name: "X", subject_entity_type: "brand" },
            evidence_excerpt: "maybe",
            confidence: 0.4,
            reasoning: "guess",
          },
        ],
      },
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    const supabase = buildFakeSupabase();
    const result = await extractCandidatesFromTurn(supabase as never, baseInput);
    expect(result.dropped).toBe(1);
    expect(result.candidatesCreated).toBe(0);
    expect(result.autoPromoted).toBe(0);
    expect(supabase.calls.rpc).toHaveLength(0);
  });

  it("inserts mid-confidence candidates as pending (0.6 <= conf <= 0.8)", async () => {
    const { extractCandidatesFromTurn } = await import("./chat-extraction");
    generateObjectMock.mockResolvedValueOnce({
      object: {
        candidates: [
          {
            kind: "rule",
            content: { rule_type: "always", rule_text: "Always cite source pages." },
            evidence_excerpt: "Always cite source pages",
            confidence: 0.7,
            reasoning: "explicit always-rule",
          },
        ],
      },
      usage: { inputTokens: 200, outputTokens: 80 },
    });
    const supabase = buildFakeSupabase();
    const result = await extractCandidatesFromTurn(supabase as never, baseInput);
    expect(result.candidatesCreated).toBe(1);
    expect(result.autoPromoted).toBe(0);
    expect(supabase.calls.rpc).toHaveLength(1);
    expect(supabase.calls.rpc[0][0]).toBe("insert_memory_candidate");
    expect(supabase.calls.rpc[0][1].p_actor).toBe("system:workflow:chat-extraction");
    expect(supabase.calls.rpc[0][1].p_kind).toBe("rule");
  });

  it("auto-promotes high-confidence (> 0.8) candidates when CHAT_EXTRACTOR_ENABLED=true", async () => {
    process.env.CHAT_EXTRACTOR_ENABLED = "true";
    const { extractCandidatesFromTurn } = await import("./chat-extraction");
    generateObjectMock.mockResolvedValueOnce({
      object: {
        candidates: [
          {
            kind: "fact",
            content: {
              subject_entity_name: "Lavazza",
              subject_entity_type: "brand",
              predicate: "launched",
              object_entity_name: "Eraclea",
              object_entity_type: "sku",
              valid_from: "2024-03-01",
            },
            evidence_excerpt: "Lavazza launched Eraclea in March 2024",
            confidence: 0.95,
            reasoning: "explicit launch fact with date",
          },
        ],
      },
      usage: { inputTokens: 200, outputTokens: 100 },
    });
    const supabase = buildFakeSupabase();
    const result = await extractCandidatesFromTurn(supabase as never, baseInput);
    expect(result.autoPromoted).toBe(1);
    expect(result.candidatesCreated).toBe(0);
    expect(supabase.calls.rpc).toHaveLength(1);
    expect(supabase.calls.rpc[0][0]).toBe("auto_promote_high_confidence");
  });

  it("DRY MODE: high-confidence (> 0.8) lands as pending when flag is false", async () => {
    delete process.env.CHAT_EXTRACTOR_ENABLED;
    const { extractCandidatesFromTurn } = await import("./chat-extraction");
    generateObjectMock.mockResolvedValueOnce({
      object: {
        candidates: [
          {
            kind: "fact",
            content: {
              subject_entity_name: "Mondelez",
              subject_entity_type: "organization",
              predicate: "acquired",
              object_entity_name: "Chipita",
              object_entity_type: "organization",
              valid_from: "2022-01-01",
            },
            evidence_excerpt: "Mondelez acquired Chipita in January 2022",
            confidence: 0.96,
            reasoning: "explicit acquisition fact",
          },
        ],
      },
      usage: { inputTokens: 200, outputTokens: 100 },
    });
    const supabase = buildFakeSupabase();
    const result = await extractCandidatesFromTurn(supabase as never, baseInput);
    expect(result.candidatesCreated).toBe(1);
    expect(result.autoPromoted).toBe(0);
    expect(supabase.calls.rpc).toHaveLength(1);
    expect(supabase.calls.rpc[0][0]).toBe("insert_memory_candidate");
  });

  it("returns empty result on null-extraction (LLM returns empty array)", async () => {
    const { extractCandidatesFromTurn } = await import("./chat-extraction");
    generateObjectMock.mockResolvedValueOnce({
      object: { candidates: [] },
      usage: { inputTokens: 150, outputTokens: 20 },
    });
    const supabase = buildFakeSupabase();
    const result = await extractCandidatesFromTurn(supabase as never, baseInput);
    expect(result.candidatesCreated).toBe(0);
    expect(result.autoPromoted).toBe(0);
    expect(result.dropped).toBe(0);
    expect(supabase.calls.rpc).toHaveLength(0);
    // Workflow run still recorded for telemetry
    expect(supabase.calls.update).toHaveLength(1);
    expect((supabase.calls.update[0] as { status: string }).status).toBe("success");
  });

  it("falls back to insert when auto_promote RPC fails", async () => {
    process.env.CHAT_EXTRACTOR_ENABLED = "true";
    const { extractCandidatesFromTurn } = await import("./chat-extraction");
    generateObjectMock.mockResolvedValueOnce({
      object: {
        candidates: [
          {
            kind: "fact",
            content: { predicate: "x", subject_entity_name: "X", subject_entity_type: "brand" },
            evidence_excerpt: "x",
            confidence: 0.95,
            reasoning: "test",
          },
        ],
      },
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    const fake = buildFakeSupabase();
    fake.rpc = vi.fn((name: string, params: Record<string, unknown>) => {
      fake.calls.rpc.push([name, params]);
      if (name === "auto_promote_high_confidence") {
        return Promise.resolve({ data: null, error: { message: "rpc error" } });
      }
      return Promise.resolve({ data: "c-id", error: null });
    }) as never;
    const result = await extractCandidatesFromTurn(fake as never, baseInput);
    expect(result.autoPromoted).toBe(0);
    expect(result.candidatesCreated).toBe(1);
    expect(fake.calls.rpc.map((r) => r[0])).toEqual([
      "auto_promote_high_confidence",
      "insert_memory_candidate",
    ]);
  });
});
