// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { UIMessage } from "ai";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/workspace-chat/ChatMarkdown", () => ({
  ChatMarkdown: ({ source }: { source: string }) => React.createElement("div", null, source),
}));

import { ChatMessage } from "@/components/workspace-chat/ChatMessage";

afterEach(() => {
  cleanup();
});

describe("ChatMessage density rules", () => {
  it("keeps the first three tool cards full and compacts the fourth", () => {
    const { container } = render(
      React.createElement(ChatMessage, {
        message: messageWithMetricCards(),
        isStreaming: false,
      }),
    );

    expect(container.querySelectorAll(".wbeta-ai-tool-frame")).toHaveLength(4);
    expect(container.querySelectorAll(".wbeta-ai-tool-frame-compact")).toHaveLength(1);
    expect(container.querySelector(".wbeta-ai-tool-frame-compact summary")?.textContent).toContain(
      "Details",
    );
  });
});

function messageWithMetricCards(): UIMessage {
  return {
    id: "m-density",
    role: "assistant",
    parts: [
      { type: "text", text: "Here are the cards." },
      metricPart("Net sales", "12.4"),
      metricPart("Distribution", "82"),
      metricPart("Price index", "104"),
      metricPart("Promo pressure", "18"),
    ],
  } as unknown as UIMessage;
}

function metricPart(label: string, value: string) {
  return {
    type: "tool-showMetricCard",
    state: "output-available",
    input: {
      label,
      value,
      unit: "%",
      source_label: "s1",
    },
  };
}
