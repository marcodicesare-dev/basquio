import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const insert = vi.fn();
  const eq = vi.fn();
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select, insert }));
  const createServiceSupabaseClient = vi.fn(() => ({ from }));
  const search = vi.fn();
  const createFirecrawlClient = vi.fn(() => ({ search }));
  return { createServiceSupabaseClient, createFirecrawlClient, search, from, select, eq, insert };
});

vi.mock("@/lib/supabase/admin", () => ({
  createServiceSupabaseClient: mocks.createServiceSupabaseClient,
}));

vi.mock("@basquio/research", () => ({
  createFirecrawlClient: mocks.createFirecrawlClient,
}));

import { recencyToTbs, webSearchTool } from "./agent-tools-web-search";

const ctx = {
  workspaceId: "workspace-1",
  currentScopeId: null,
  conversationId: "conversation-1",
  userEmail: "marco@example.com",
  userId: "00000000-0000-0000-0000-000000000001",
};

const baseInput = {
  query: "coffee market trends",
  max_results: 2,
  recency: "past_year" as const,
  source_type: "web" as const,
  country: "IT",
  language: "it",
};

beforeEach(() => {
  process.env.FIRECRAWL_API_KEY = "test-firecrawl-key";
  mocks.createServiceSupabaseClient.mockClear();
  mocks.createFirecrawlClient.mockClear();
  mocks.search.mockReset();
  mocks.from.mockClear();
  mocks.select.mockClear();
  mocks.eq.mockReset();
  mocks.insert.mockReset();
  mocks.eq.mockResolvedValue({ count: 0, error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.search.mockResolvedValue({
    success: true,
    creditsUsed: 2,
    data: [
      {
        url: "https://example.com/coffee",
        title: "Italy coffee report",
        data: {
          markdown: "Coffee markdown body",
          metadata: { "article:published_time": "2026-03-01T00:00:00Z" },
        },
      },
    ],
  });
});

async function executeWebSearch(input: typeof baseInput = baseInput) {
  const toolDef = webSearchTool(ctx) as unknown as {
    execute: (input: typeof baseInput) => Promise<unknown>;
  };
  return toolDef.execute(input);
}

describe("webSearchTool", () => {
  it("returns scraped search results and logs the call", async () => {
    const result = await executeWebSearch();

    expect(mocks.createFirecrawlClient).toHaveBeenCalledWith({ apiKey: "test-firecrawl-key" });
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "coffee market trends mercato Italia",
        limit: 2,
        sources: [{ type: "web" }],
        location: "IT",
        tbs: "qdr:y",
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        budget_remaining: 199,
        warning: null,
        credits_used: 2,
        results: [
          {
            url: "https://example.com/coffee",
            title: "Italy coffee report",
            citation: "Italy coffee report | https://example.com/coffee | 2026-03-01T00:00:00Z",
            published_at: "2026-03-01T00:00:00Z",
            markdown: "Coffee markdown body",
          },
        ],
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        citation_instruction: expect.stringContaining("cite the exact URL"),
      }),
    );
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "conversation-1",
        query: "coffee market trends",
        result_count: 1,
        credits_used: 2,
      }),
    );
  });

  it("supports Firecrawl v2 source-keyed search responses", async () => {
    mocks.search.mockResolvedValue({
      success: true,
      creditsUsed: 1,
      data: {
        web: [
          {
            url: "https://example.com/live-shape",
            title: "Live shape result",
            markdown: "Live markdown body",
            metadata: { "article:published_time": "2026-04-01T00:00:00Z" },
          },
        ],
      },
    });

    const result = await executeWebSearch();

    expect(result).toEqual(
      expect.objectContaining({
        credits_used: 1,
        results: [
          {
            url: "https://example.com/live-shape",
            title: "Live shape result",
            citation: "Live shape result | https://example.com/live-shape | 2026-04-01T00:00:00Z",
            published_at: "2026-04-01T00:00:00Z",
            markdown: "Live markdown body",
          },
        ],
      }),
    );
  });

  it("returns a soft warning at ten searches in a conversation", async () => {
    mocks.eq.mockResolvedValue({ count: 9, error: null });

    const result = await executeWebSearch();

    expect(result).toEqual(
      expect.objectContaining({
        budget_remaining: 190,
        warning: expect.stringContaining("10/200"),
      }),
    );
  });

  it("blocks searches at the hard cap", async () => {
    mocks.eq.mockResolvedValue({ count: 200, error: null });

    const result = await executeWebSearch();

    expect(result).toEqual({
      error: "This conversation has reached the web search cap (200). Start a new conversation to continue searching.",
    });
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("logs zero-credit cache hits without inflating the budget", async () => {
    mocks.search.mockResolvedValue({
      success: true,
      creditsUsed: 0,
      data: [
        {
          url: "https://example.com/cached",
          title: "Cached result",
          data: { markdown: "Cached markdown", metadata: {} },
        },
      ],
    });

    const result = await executeWebSearch();

    expect(result).toEqual(expect.objectContaining({ credits_used: 0 }));
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        credits_used: 0,
      }),
    );
  });

  it("continues searching when the telemetry tables are not migrated yet", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const missingTableError = {
      code: "PGRST205",
      message: "Could not find the table 'public.chat_web_search_calls' in the schema cache",
    };
    mocks.eq.mockResolvedValue({ count: null, error: missingTableError });
    mocks.insert.mockResolvedValue({ error: missingTableError });

    const result = await executeWebSearch();

    expect(result).toEqual(
      expect.objectContaining({
        credits_used: 2,
        results: [
          expect.objectContaining({
            url: "https://example.com/coffee",
          }),
        ],
      }),
    );
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("returns a structured error for invalid Firecrawl response shapes", async () => {
    mocks.search.mockResolvedValue({
      success: false,
      error: "Invalid request body",
    });

    const result = await executeWebSearch();

    expect(result).toEqual({
      error: "Web search failed: Invalid request body. Try rephrasing the query or check workspace context with retrieveContext.",
    });
  });
});

describe("recencyToTbs", () => {
  it("maps recency filters to Firecrawl tbs values", () => {
    expect(recencyToTbs("past_year")).toBe("qdr:y");
    expect(recencyToTbs("past_month")).toBe("qdr:m");
    expect(recencyToTbs("past_week")).toBe("qdr:w");
    expect(recencyToTbs("anytime")).toBeUndefined();
  });
});
