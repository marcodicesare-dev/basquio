import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeUsage = { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0 };
const fakeValidateUsage = { inputTokens: 200, outputTokens: 100, cachedInputTokens: 0 };

const collectorState = vi.hoisted(() => ({
  extractUsage: { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0 },
  validateUsage: { inputTokens: 200, outputTokens: 100, cachedInputTokens: 0 },
  callCount: 0,
}));

vi.mock("@boundaryml/baml", () => ({
  Collector: class MockCollector {
    public readonly name: string;
    constructor(name?: string) {
      this.name = name ?? "default";
    }
    get usage() {
      collectorState.callCount += 1;
      // Alternate: first instance is extract, second is validate.
      return collectorState.callCount % 2 === 1
        ? collectorState.extractUsage
        : collectorState.validateUsage;
    }
  },
}));

const bamlMock = vi.hoisted(() => ({
  ExtractBrandGuideline: vi.fn(),
  ValidateBrandGuideline: vi.fn(),
}));

vi.mock("../../baml_client", () => ({
  b: bamlMock,
}));

const SAMPLE_EXTRACTION = {
  brand: "Spotify",
  version: "2024",
  typography: [
    { surface: "HEADLINE", font_family: "Spotify Mix", weight: 700, size_px: 48, source_page: 5 },
  ],
  colour: [{ name: "Spotify Green", hex: "#1ED760", source_page: 8 }],
  tone: [
    {
      voice_attribute: "Direct",
      do_examples: ["Say it"],
      dont_examples: ["Beat around the bush"],
      sample_sentences: [],
      source_page: 12,
    },
  ],
  imagery: [
    { rule: "Use real people", approved_examples_url: [], forbidden_examples_url: [], source_page: 18 },
  ],
  forbidden: ["fancy"],
  language_preferences: [{ source_form: "color", preferred_form: "colour" }],
  layout_constraints: ["8-col grid"],
  logo_rules: ["minimum 24px"],
  extraction_confidence: 0.92,
};

beforeEach(() => {
  collectorState.extractUsage = { ...fakeUsage };
  collectorState.validateUsage = { ...fakeValidateUsage };
  collectorState.callCount = 0;
  bamlMock.ExtractBrandGuideline.mockReset();
  bamlMock.ValidateBrandGuideline.mockReset();
});

function buildFakeSupabase(rpcResult: { data: unknown; error: unknown }) {
  const calls: { rpc: unknown[][]; insert: unknown[]; update: unknown[]; upsert: unknown[] } = {
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
    return Promise.resolve(rpcResult);
  });
  return { from: fakeFrom, rpc: fakeRpc, calls, ensuredWorkflowId, runId };
}

const baseInput = {
  workspaceId: "11111111-aaaa-bbbb-cccc-000000000001",
  organizationId: "11111111-aaaa-bbbb-cccc-000000000001",
  documentId: "11111111-aaaa-bbbb-cccc-000000000002",
  pdfText: "Spotify brand guide. Headline font is Spotify Mix.",
  pageCount: 21,
  actor: "system:workflow:brand-extraction",
};

describe("runBrandGuidelineExtraction", () => {
  it("rejects when validation confidence is below 0.7 and does not call the persist RPC", async () => {
    bamlMock.ExtractBrandGuideline.mockResolvedValueOnce(SAMPLE_EXTRACTION);
    bamlMock.ValidateBrandGuideline.mockResolvedValueOnce({
      confidence: 0.55,
      reason: "missing source pages on tone rules",
      issues: ["tone[0].source_page is null"],
    });

    const supabase = buildFakeSupabase({ data: null, error: null });

    const { runBrandGuidelineExtraction, BrandExtractionValidationError } = await import(
      "./brand-extraction"
    );

    await expect(
      runBrandGuidelineExtraction(supabase as never, baseInput),
    ).rejects.toBeInstanceOf(BrandExtractionValidationError);

    expect(supabase.calls.rpc).toHaveLength(0);
    // begin + finish writes should still happen.
    expect(supabase.calls.insert).toHaveLength(1);
    expect(supabase.calls.update).toHaveLength(1);
    expect((supabase.calls.update[0] as { status: string }).status).toBe("failure");
  });

  it("calls persist_brand_guideline RPC with the right actor and returns the brand_guideline id on success", async () => {
    bamlMock.ExtractBrandGuideline.mockResolvedValueOnce(SAMPLE_EXTRACTION);
    bamlMock.ValidateBrandGuideline.mockResolvedValueOnce({
      confidence: 0.93,
      reason: "all checks pass",
      issues: [],
    });

    const persistedId = "99999999-9999-9999-9999-999999999999";
    const supabase = buildFakeSupabase({ data: persistedId, error: null });

    const { runBrandGuidelineExtraction } = await import("./brand-extraction");

    const result = await runBrandGuidelineExtraction(supabase as never, baseInput);

    expect(result.brandGuidelineId).toBe(persistedId);
    expect(result.brand).toBe("Spotify");
    expect(result.validationConfidence).toBe(0.93);
    expect(result.ruleCounts.typography).toBe(1);
    expect(result.ruleCounts.colour).toBe(1);

    expect(supabase.calls.rpc).toHaveLength(1);
    const [rpcName, rpcParams] = supabase.calls.rpc[0] as [string, Record<string, unknown>];
    expect(rpcName).toBe("persist_brand_guideline");
    expect(rpcParams.p_actor).toBe("system:workflow:brand-extraction");
    expect(rpcParams.p_workspace_id).toBe(baseInput.workspaceId);
    expect(rpcParams.p_brand).toBe("Spotify");
    expect(rpcParams.p_workflow_run_id).toBe(supabase.runId);
    expect(rpcParams.p_extraction_confidence).toBe(SAMPLE_EXTRACTION.extraction_confidence);

    // finishWorkflowRun marks success.
    const finalUpdate = supabase.calls.update[supabase.calls.update.length - 1] as { status: string };
    expect(finalUpdate.status).toBe("success");
  });

  it("treats persist RPC errors as failures and re-throws", async () => {
    bamlMock.ExtractBrandGuideline.mockResolvedValueOnce(SAMPLE_EXTRACTION);
    bamlMock.ValidateBrandGuideline.mockResolvedValueOnce({
      confidence: 0.91,
      reason: "ok",
      issues: [],
    });

    const supabase = buildFakeSupabase({
      data: null,
      error: { message: "duplicate key value violates unique constraint", code: "23505" },
    });

    const { runBrandGuidelineExtraction } = await import("./brand-extraction");
    await expect(
      runBrandGuidelineExtraction(supabase as never, baseInput),
    ).rejects.toThrow(/persist_brand_guideline RPC failed/);

    const finalUpdate = supabase.calls.update[supabase.calls.update.length - 1] as { status: string };
    expect(finalUpdate.status).toBe("failure");
  });

  it("requires a non-empty actor", async () => {
    const supabase = buildFakeSupabase({ data: null, error: null });
    const { runBrandGuidelineExtraction } = await import("./brand-extraction");
    await expect(
      runBrandGuidelineExtraction(supabase as never, { ...baseInput, actor: "" }),
    ).rejects.toThrow(/actor is required/);
    // Should not even open a workflow run when actor is missing.
    expect(supabase.calls.insert).toHaveLength(0);
  });
});
