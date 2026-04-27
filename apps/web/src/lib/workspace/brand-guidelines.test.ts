import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabase = vi.hoisted(() => {
  const builder: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    ilike: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    _result: { data: unknown; error: unknown };
  } = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    is: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(builder._result)),
    _result: { data: null, error: null },
  };
  // Make every awaited builder resolve to the same shape (for searchBrandRules).
  Object.defineProperty(builder, "then", {
    value: (onFulfilled: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve(builder._result).then(onFulfilled),
    enumerable: false,
  });
  return {
    from: vi.fn(() => builder),
    builder,
    setResult(result: { data: unknown; error: unknown }) {
      builder._result = result;
    },
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createServiceSupabaseClient: () => mockSupabase,
}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
  mockSupabase.from.mockClear();
  mockSupabase.builder.select.mockClear();
  mockSupabase.builder.eq.mockClear();
  mockSupabase.builder.ilike.mockClear();
  mockSupabase.builder.is.mockClear();
  mockSupabase.builder.order.mockClear();
  mockSupabase.builder.limit.mockClear();
  mockSupabase.builder.maybeSingle.mockClear();
});

const SAMPLE_GUIDELINE = {
  id: "guideline-uuid",
  workspace_id: "workspace-uuid",
  brand_entity_id: null,
  brand: "Spotify",
  version: "2024",
  source_document_id: "doc-uuid",
  typography: [
    { surface: "HEADLINE", font_family: "Spotify Mix", weight: 700, size_px: 48, source_page: 5 },
    { surface: "BODY", font_family: "Circular", weight: 400, size_px: 16, source_page: 6 },
  ],
  colour: [
    { name: "Spotify Green", hex: "#1ED760", source_page: 8 },
    { name: "Black", hex: "#000000", source_page: 8 },
  ],
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
  forbidden: ["fancy", "premium"],
  language_preferences: [],
  layout: ["8-col grid", "13px gutter"],
  logo: ["minimum 24px"],
  extraction_method: "baml",
  extraction_confidence: 0.92,
  extracted_at: "2026-04-27T10:00:00Z",
  approved_by: null,
  approved_at: null,
  superseded_by: null,
  metadata: {},
};

describe("getActiveBrandGuideline", () => {
  it("returns the latest non-superseded guideline for (workspace, brand)", async () => {
    const { getActiveBrandGuideline } = await import("./brand-guidelines");
    mockSupabase.setResult({ data: SAMPLE_GUIDELINE, error: null });
    const guideline = await getActiveBrandGuideline("workspace-uuid", "Spotify");
    expect(guideline).not.toBeNull();
    expect(guideline?.brand).toBe("Spotify");
    expect(mockSupabase.builder.eq).toHaveBeenCalledWith("workspace_id", "workspace-uuid");
    expect(mockSupabase.builder.ilike).toHaveBeenCalledWith("brand", "Spotify");
    expect(mockSupabase.builder.is).toHaveBeenCalledWith("superseded_by", null);
    expect(mockSupabase.builder.order).toHaveBeenCalledWith("extracted_at", { ascending: false });
    expect(mockSupabase.builder.limit).toHaveBeenCalledWith(1);
  });

  it("returns null gracefully when no row exists", async () => {
    const { getActiveBrandGuideline } = await import("./brand-guidelines");
    mockSupabase.setResult({ data: null, error: null });
    const guideline = await getActiveBrandGuideline("workspace-uuid", "Unknown");
    expect(guideline).toBeNull();
  });

  it("throws when supabase reports an error", async () => {
    const { getActiveBrandGuideline } = await import("./brand-guidelines");
    mockSupabase.setResult({ data: null, error: { message: "permission denied" } });
    await expect(getActiveBrandGuideline("workspace-uuid", "Spotify")).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("searchBrandRules", () => {
  it("flattens typography / colour / tone / imagery into hits with source_page", async () => {
    const { searchBrandRules } = await import("./brand-guidelines");
    mockSupabase.setResult({ data: [SAMPLE_GUIDELINE], error: null });
    const hits = await searchBrandRules("workspace-uuid", { brand: "Spotify" });
    const ruleTypes = new Set(hits.map((h) => h.ruleType));
    expect(ruleTypes.has("typography")).toBe(true);
    expect(ruleTypes.has("colour")).toBe(true);
    expect(ruleTypes.has("tone")).toBe(true);
    expect(ruleTypes.has("imagery")).toBe(true);

    // Every hit must carry source_page (per spec §4 hard requirement).
    for (const hit of hits) {
      expect(hit.sourcePage).not.toBeNull();
      expect(hit.sourcePage).toBeGreaterThan(0);
    }
  });

  it("filters by ruleType when requested", async () => {
    const { searchBrandRules } = await import("./brand-guidelines");
    mockSupabase.setResult({ data: [SAMPLE_GUIDELINE], error: null });
    const hits = await searchBrandRules("workspace-uuid", { ruleType: "typography" });
    expect(hits.every((h) => h.ruleType === "typography")).toBe(true);
    expect(hits).toHaveLength(2);
  });

  it("returns empty array when no guidelines exist", async () => {
    const { searchBrandRules } = await import("./brand-guidelines");
    mockSupabase.setResult({ data: [], error: null });
    const hits = await searchBrandRules("workspace-uuid", {});
    expect(hits).toEqual([]);
  });
});
