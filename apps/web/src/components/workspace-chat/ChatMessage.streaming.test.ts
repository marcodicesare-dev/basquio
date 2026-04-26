// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  it("renders streaming assistant text through the markdown pipeline", () => {
    const message = assistantMessage("m1", "Here is **markdown** while streaming.");

    const { rerender, container } = render(
      React.createElement(ChatMessage, { message, isStreaming: true }),
    );

    expect(container.querySelector(".wbeta-ai-streaming-text")?.textContent).toContain(
      "Here is **markdown** while streaming.",
    );
    expect(container.querySelector(".wbeta-ai-md-streaming")).not.toBeNull();
    expect(mocks.reactMarkdown).toHaveBeenCalledTimes(1);

    rerender(React.createElement(ChatMessage, { message, isStreaming: false }));

    expect(container.querySelector(".wbeta-ai-md-streaming")).toBeNull();
    expect(mocks.reactMarkdown).toHaveBeenCalledTimes(2);
  });

  it("collapses streamed reasoning once answer text is present", () => {
    const message = {
      id: "m2",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "Checking workspace knowledge." },
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

    expect(screen.getByText("Searching web")).not.toBeNull();
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

    expect(screen.getByText("Searched web, 2 results")).not.toBeNull();
  });

  it("shows filenames for retrieved workspace source excerpts", () => {
    const message = {
      id: "m-source",
      role: "assistant",
      parts: [
        {
          type: "tool-retrieveContext",
          state: "output-available",
          output: {
            chunk_count: 2,
            entity_count: 1,
            fact_count: 3,
            chunks: [
              {
                label: "s1",
                source_type: "document",
                filename: "Coffee market brief.pdf",
                content: "Capsule and RTD notes",
              },
              {
                label: "s2",
                source_type: "document",
                filename: "Italy coffee 2025.xlsx",
                content: "Retail data",
              },
            ],
          },
        },
      ],
    } as unknown as UIMessage;

    render(React.createElement(ChatMessage, { message, isStreaming: false }));

    fireEvent.click(screen.getByRole("button", { name: /Found 2 source excerpts/ }));

    expect(screen.getByText("Coffee market brief.pdf")).not.toBeNull();
    expect(screen.getByText("Italy coffee 2025.xlsx")).not.toBeNull();
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
    expect(screen.getByText(/Web search failed: Invalid request body/)).not.toBeNull();
  });

  it("opens the deck generator from draftBrief without sending a chat follow-up", () => {
    const onOpenGenerateDrawer = vi.fn();
    const onSendFollowUp = vi.fn();
    const message = {
      id: "m6",
      role: "assistant",
      parts: [
        {
          type: "tool-draftBrief",
          state: "output-available",
          output: {
            ok: true,
            brief: {
              title: "Coffee Italy 2025",
              objective: "Build a coffee market deck.",
              audience: "Insights team",
              deck_length: "13 slides",
            },
            context_preview: {
              scoped_stakeholder_count: 0,
              workspace_memory_count: 15,
              workspace_file_count: 14,
            },
            include_research: true,
          },
        },
        { type: "text", text: "Brief: Coffee Italy 2025\nObjective: full assistant brief text." },
      ],
    } as unknown as UIMessage;

    render(
      React.createElement(ChatMessage, {
        message,
        isStreaming: false,
        onOpenGenerateDrawer,
        onSendFollowUp,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate deck from this brief" }));

    expect(onOpenGenerateDrawer).toHaveBeenCalledWith({
      messageId: "m6",
      draftBrief: expect.objectContaining({
        brief: expect.objectContaining({ title: "Coffee Italy 2025" }),
      }),
      sourceText: "Brief: Coffee Italy 2025\nObjective: full assistant brief text.",
    });
    expect(onSendFollowUp).not.toHaveBeenCalled();
    expect(screen.getByText("14 workspace files available")).not.toBeNull();
  });
});

function assistantMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage;
}
