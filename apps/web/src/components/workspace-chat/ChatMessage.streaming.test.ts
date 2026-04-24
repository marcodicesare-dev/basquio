// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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

  it("collapses streamed reasoning once answer text is present", () => {
    const message = {
      id: "m2",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "Checking workspace memory." },
        { type: "text", text: "The answer starts now." },
      ],
    } as unknown as UIMessage;

    render(React.createElement(ChatMessage, { message, isStreaming: true }));

    expect(screen.getByText("Show thinking")).not.toBeNull();
    expect((document.querySelector(".wbeta-ai-reasoning") as HTMLDetailsElement).open).toBe(false);
  });

  it("renders an inline tool call chip for active tools", () => {
    const message = {
      id: "m3",
      role: "assistant",
      parts: [{ type: "tool-webSearch", state: "input-available", input: { query: "coffee" } }],
    } as unknown as UIMessage;

    render(React.createElement(ChatMessage, { message, isStreaming: true }));

    expect(screen.getByText("Using webSearch")).not.toBeNull();
  });

  it("summarizes completed webSearch tool output", () => {
    const message = {
      id: "m4",
      role: "assistant",
      parts: [
        {
          type: "tool-webSearch",
          state: "output-available",
          output: { results: [{ title: "A" }, { title: "B" }] },
        },
      ],
    } as unknown as UIMessage;

    render(React.createElement(ChatMessage, { message, isStreaming: false }));

    expect(screen.getByText("Used webSearch, 2 results")).not.toBeNull();
  });

  it("marks structured tool error outputs as failed chips", () => {
    const message = {
      id: "m5",
      role: "assistant",
      parts: [
        {
          type: "tool-webSearch",
          state: "output-available",
          output: { error: "Web search failed: Invalid request body." },
        },
      ],
    } as unknown as UIMessage;

    render(React.createElement(ChatMessage, { message, isStreaming: false }));

    expect(screen.getByText("Web search failed")).not.toBeNull();
    expect(screen.getByText("Web search failed: Invalid request body.")).not.toBeNull();
  });
});

function assistantMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage;
}
