// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

const mocks = vi.hoisted(() => ({
  chatMarkdown: vi.fn(() => null),
}));

vi.mock("@/components/workspace-chat/ChatMarkdown", () => ({
  ChatMarkdown: mocks.chatMarkdown,
}));

import { ChatMessage } from "@/components/workspace-chat/ChatMessage";

afterEach(() => {
  cleanup();
  mocks.chatMarkdown.mockClear();
});

describe("ChatMessage memo comparator", () => {
  it("skips unrelated parent rerenders for deeply equal completed messages", () => {
    const text = "Completed answer with a citation [s1].";
    const { rerender } = render(
      React.createElement(ChatMessage, {
        message: assistantMessage("m1", text),
        isStreaming: false,
      }),
    );
    expect(mocks.chatMarkdown).toHaveBeenCalledTimes(1);

    rerender(
      React.createElement(ChatMessage, {
        message: assistantMessage("m1", text),
        isStreaming: false,
      }),
    );
    expect(mocks.chatMarkdown).toHaveBeenCalledTimes(1);
  });

  it("rerenders streaming text only when the cheap token-batch signature changes", () => {
    const text = "Streaming answer";
    const { container, rerender } = render(
      React.createElement(ChatMessage, {
        message: assistantMessage("m1", text),
        isStreaming: true,
      }),
    );
    const firstStreamingNode = container.querySelector(".wbeta-ai-streaming-text");

    rerender(
      React.createElement(ChatMessage, {
        message: assistantMessage("m1", text),
        isStreaming: true,
      }),
    );
    expect(container.querySelector(".wbeta-ai-streaming-text")).toBe(firstStreamingNode);

    rerender(
      React.createElement(ChatMessage, {
        message: assistantMessage("m1", `${text}.`),
        isStreaming: true,
      }),
    );
    expect(container.querySelector(".wbeta-ai-streaming-text")?.textContent).toContain(
      `${text}.`,
    );
  });
});

function assistantMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage;
}
