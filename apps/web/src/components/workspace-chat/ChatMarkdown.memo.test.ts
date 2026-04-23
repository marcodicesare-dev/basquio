// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

const mocks = vi.hoisted(() => ({
  reactMarkdown: vi.fn(({ children }: { children?: unknown }) => children),
}));

vi.mock("react-markdown", () => ({
  default: mocks.reactMarkdown,
}));

import { ChatMarkdown } from "@/components/workspace-chat/ChatMarkdown";

afterEach(() => {
  cleanup();
  mocks.reactMarkdown.mockClear();
});

describe("ChatMarkdown memo comparator", () => {
  it("skips markdown reparses when completed content and citations are deeply equal", () => {
    const source = "A completed answer with **formatting** and [s1].";
    const citations = [{ label: "s1", filename: "source.csv", excerpt: "Evidence" }];

    const { rerender } = render(
      React.createElement(ChatMarkdown, { source, citations }),
    );
    expect(mocks.reactMarkdown).toHaveBeenCalledTimes(1);

    rerender(
      React.createElement(ChatMarkdown, {
        source,
        citations: [{ label: "s1", filename: "source.csv", excerpt: "Evidence" }],
      }),
    );

    expect(mocks.reactMarkdown).toHaveBeenCalledTimes(1);
  });

  it("uses cheap streaming identity and rerenders only when the streamed batch changes length", () => {
    const source = "Streaming answer chunk";

    const { rerender } = render(
      React.createElement(ChatMarkdown, { source, citations: [], isStreaming: true }),
    );
    expect(mocks.reactMarkdown).toHaveBeenCalledTimes(1);

    rerender(
      React.createElement(ChatMarkdown, {
        source,
        citations: [],
        isStreaming: true,
      }),
    );
    expect(mocks.reactMarkdown).toHaveBeenCalledTimes(1);

    rerender(
      React.createElement(ChatMarkdown, {
        source: `${source}.`,
        citations: [],
        isStreaming: true,
      }),
    );
    expect(mocks.reactMarkdown).toHaveBeenCalledTimes(2);
  });
});
