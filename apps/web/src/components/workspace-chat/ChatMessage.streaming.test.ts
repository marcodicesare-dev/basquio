// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

const mocks = vi.hoisted(() => ({
  reactMarkdown: vi.fn(({ children }: { children?: unknown }) => children),
}));

vi.mock("react-markdown", () => ({
  default: mocks.reactMarkdown,
}));

import { ChatMessage } from "@/components/workspace-chat/ChatMessage";

afterEach(() => {
  cleanup();
  mocks.reactMarkdown.mockClear();
});

describe("ChatMessage streaming render", () => {
  it("does not invoke ReactMarkdown while the last assistant text part is streaming", () => {
    const message = assistantMessage("m1", "Here is **markdown** while streaming.");

    const { rerender, container } = render(
      React.createElement(ChatMessage, { message, isStreaming: true }),
    );

    expect(container.querySelector(".wbeta-ai-streaming-text")?.textContent).toContain(
      "Here is **markdown** while streaming.",
    );
    expect(mocks.reactMarkdown).toHaveBeenCalledTimes(0);

    rerender(React.createElement(ChatMessage, { message, isStreaming: false }));

    expect(mocks.reactMarkdown).toHaveBeenCalledTimes(1);
  });
});

function assistantMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage;
}
