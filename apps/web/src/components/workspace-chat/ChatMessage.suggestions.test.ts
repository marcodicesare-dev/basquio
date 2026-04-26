// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/workspace-chat/ChatMarkdown", () => ({
  ChatMarkdown: ({ source }: { source: string }) => React.createElement("div", null, source),
}));

import { ChatMessage } from "@/components/workspace-chat/ChatMessage";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ChatMessage inline suggestions", () => {
  it("renders at most three latest-assistant chips and sends the clicked follow-up", () => {
    const onSendFollowUp = vi.fn();
    render(
      React.createElement(ChatMessage, {
        message: assistantMessage("m1", "Answer with enough context to continue."),
        isStreaming: false,
        showInlineSuggestions: true,
        onSendFollowUp,
      }),
    );

    expect(screen.getByText("You might also want to:")).not.toBeNull();
    const chips = screen.getAllByRole("button", { name: /last answer|saved|presentation/i });
    expect(chips).toHaveLength(3);

    fireEvent.click(chips[0]);

    expect(onSendFollowUp).toHaveBeenCalledWith("Turn the last answer into a concise memo.");
    expect(screen.queryByText("You might also want to:")).toBeNull();
  });

  it("prefers model-provided metadata suggestions when present", () => {
    const onSendFollowUp = vi.fn();
    render(
      React.createElement(ChatMessage, {
        message: {
          ...assistantMessage("m2", "Answer with a model suggestion."),
          metadata: {
            suggestions: [
              {
                label: "Build slide",
                prompt: "Turn this into a slide outline.",
              },
            ],
          },
        },
        isStreaming: false,
        showInlineSuggestions: true,
        onSendFollowUp,
      }),
    );

    const chip = screen.getByRole("button", { name: /turn this into a slide outline/i });
    fireEvent.click(chip);

    expect(onSendFollowUp).toHaveBeenCalledWith("Turn this into a slide outline.");
  });

  it("strips streamed model suggestion blocks and turns them into chips", () => {
    const onSendFollowUp = vi.fn();
    render(
      React.createElement(ChatMessage, {
        message: assistantMessage(
          "m3",
          `Workspace chat is live and ready.

<suggestions>
- <label>Build slide</label><prompt>Turn this into a slide outline.</prompt>
- <label>Check knowledge</label><prompt>Compare this answer with saved knowledge.</prompt>
</suggestions>`,
        ),
        isStreaming: false,
        showInlineSuggestions: true,
        onSendFollowUp,
      }),
    );

    expect(screen.getByText("Workspace chat is live and ready.")).not.toBeNull();
    expect(screen.queryByText(/Build slide/)).toBeNull();
    expect(screen.queryByText(/Check knowledge/)).toBeNull();

    const chip = screen.getByRole("button", { name: /turn this into a slide outline/i });
    fireEvent.click(chip);

    expect(onSendFollowUp).toHaveBeenCalledWith("Turn this into a slide outline.");
  });
});

function assistantMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage;
}
