// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

const mocks = vi.hoisted(() => ({
  chatMarkdown: vi.fn(({ source }: { source: string }) => source),
}));

vi.mock("@/components/workspace-chat/ChatMarkdown", () => ({
  ChatMarkdown: mocks.chatMarkdown,
}));

import { ChatMessage } from "@/components/workspace-chat/ChatMessage";

afterEach(() => {
  cleanup();
  mocks.chatMarkdown.mockClear();
});

describe("ChatMessage streaming rerenders", () => {
  it("reads mutated streaming parts on parent rerenders", () => {
    const message = assistantMessage("m1", "");
    const { container, rerender } = render(
      React.createElement(ChatMessage, {
        message,
        isStreaming: true,
      }),
    );
    expect(container.querySelector(".wbeta-ai-streaming-text")).toBeNull();

    setAssistantText(message, "S");
    rerender(
      React.createElement(ChatMessage, {
        message,
        isStreaming: true,
      }),
    );
    expect(container.querySelector(".wbeta-ai-streaming-text")?.textContent).toContain("S");

    setAssistantText(message, "Streaming answer");
    rerender(
      React.createElement(ChatMessage, {
        message,
        isStreaming: true,
      }),
    );
    expect(container.querySelector(".wbeta-ai-streaming-text")?.textContent).toContain(
      "Streaming answer",
    );
  });

  it("skips redundant parent rerenders for deeply equal completed messages", () => {
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

  it("renders fresh streaming text when a new message object arrives", () => {
    const text = "Streaming answer";
    const { rerender, container } = render(
      React.createElement(ChatMessage, {
        message: assistantMessage("m1", text),
        isStreaming: true,
      }),
    );
    expect(container.querySelector(".wbeta-ai-streaming-text")?.textContent).toContain(text);

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

function setAssistantText(message: UIMessage, text: string) {
  const parts = message.parts as unknown as Array<{ type: string; text?: string }>;
  parts[0].text = text;
}
