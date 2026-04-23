// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import React from "react";

import { ChatMarkdown } from "@/components/workspace-chat/ChatMarkdown";

afterEach(() => {
  cleanup();
});

describe("ChatMarkdown", () => {
  it("keeps citation chip DOM identities stable across equivalent rerenders", () => {
    const source = "Margin story cites [s1] and channel story cites [s2].";
    const citations = [
      { label: "s1", filename: "margin.csv", excerpt: "Margin evidence" },
      { label: "s2", filename: "channel.csv", excerpt: "Channel evidence" },
    ];

    const { container, rerender } = render(
      React.createElement(ChatMarkdown, { source, citations }),
    );
    const firstRenderChips = Array.from(container.querySelectorAll(".wbeta-ai-citation"));

    rerender(React.createElement(ChatMarkdown, { source, citations }));
    const secondRenderChips = Array.from(container.querySelectorAll(".wbeta-ai-citation"));

    expect(secondRenderChips).toHaveLength(2);
    toHaveSameElement(secondRenderChips[0], firstRenderChips[0]);
    toHaveSameElement(secondRenderChips[1], firstRenderChips[1]);
  });
});

function toHaveSameElement(received: Element | undefined, expected: Element | undefined) {
  expect(received).toBe(expected);
}
