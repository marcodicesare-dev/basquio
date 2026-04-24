import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const insert = vi.fn();
  const from = vi.fn(() => ({ insert }));
  const createServiceSupabaseClient = vi.fn(() => ({ from }));
  return { createServiceSupabaseClient, from, insert };
});

vi.mock("@/lib/supabase/admin", () => ({
  createServiceSupabaseClient: mocks.createServiceSupabaseClient,
}));

import {
  hashToolInput,
  withChatToolTelemetry,
  wrapChatTool,
} from "./chat-tool-telemetry";

beforeEach(() => {
  mocks.createServiceSupabaseClient.mockClear();
  mocks.from.mockClear();
  mocks.insert.mockReset();
  mocks.insert.mockResolvedValue({ error: null });
});

describe("withChatToolTelemetry", () => {
  it("writes a success row and returns the wrapped result", async () => {
    const result = await withChatToolTelemetry({
      conversationId: "conversation-1",
      userId: "00000000-0000-0000-0000-000000000001",
      toolName: "retrieveContext",
      inputHash: hashToolInput({ query: "coffee" }),
      execute: async () => ({ ok: true, answer: "done" }),
    });

    expect(result).toEqual({ ok: true, answer: "done" });
    expect(mocks.from).toHaveBeenCalledWith("chat_tool_telemetry");
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "conversation-1",
        tool_name: "retrieveContext",
        status: "success",
        error_message: null,
        result_size_bytes: expect.any(Number),
      }),
    );
  });

  it("writes an error row when the wrapped call throws", async () => {
    await expect(
      withChatToolTelemetry({
        conversationId: "conversation-1",
        userId: "00000000-0000-0000-0000-000000000001",
        toolName: "webSearch",
        inputHash: hashToolInput({ query: "coffee" }),
        execute: async () => {
          throw new Error("Firecrawl unavailable");
        },
      }),
    ).rejects.toThrow("Firecrawl unavailable");

    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "conversation-1",
        tool_name: "webSearch",
        status: "error",
        error_message: "Firecrawl unavailable",
      }),
    );
  });

  it("marks structured tool error results as error telemetry", async () => {
    const result = await withChatToolTelemetry({
      conversationId: "conversation-1",
      userId: "00000000-0000-0000-0000-000000000001",
      toolName: "analyzeAttachedFile",
      inputHash: hashToolInput({ document_ids: [] }),
      execute: async () => ({ ok: false, error: "No files found" }),
    });

    expect(result).toEqual({ ok: false, error: "No files found" });
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        error_message: "No files found",
      }),
    );
  });

  it("does not fail tool execution when the telemetry table is absent", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.insert.mockResolvedValue({
      error: {
        code: "PGRST205",
        message: "Could not find the table 'public.chat_tool_telemetry' in the schema cache",
      },
    });

    const result = await withChatToolTelemetry({
      conversationId: "conversation-1",
      userId: "00000000-0000-0000-0000-000000000001",
      toolName: "webSearch",
      inputHash: hashToolInput({ query: "coffee" }),
      execute: async () => ({ ok: true }),
    });

    expect(result).toEqual({ ok: true });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("wrapChatTool", () => {
  it("catches thrown tool failures and returns a structured error", async () => {
    const wrapped = wrapChatTool(
      "retrieveContext",
      { conversationId: "conversation-1", userId: "00000000-0000-0000-0000-000000000001" },
      {
        execute: async (_input: unknown) => {
          expect(_input).toEqual({ query: "coffee" });
          throw new Error("database offline");
        },
      },
    );

    await expect(wrapped.execute?.({ query: "coffee" })).resolves.toEqual({
      error: "retrieveContext failed: database offline",
    });
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_name: "retrieveContext",
        status: "error",
        error_message: "database offline",
      }),
    );
  });
});
