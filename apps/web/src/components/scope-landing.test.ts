// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React, { type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScopeLanding } from "@/components/scope-landing";

type ScopeLandingProps = ComponentProps<typeof ScopeLanding>;

const scrollIntoView = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  cleanup();
  scrollIntoView.mockClear();
  window.localStorage.clear();
});

describe("ScopeLanding", () => {
  it("keeps the spec order: stakeholders, knows, deliverables, suggestions, chat", () => {
    render(React.createElement(ScopeLanding, baseProps()));

    const headings = screen
      .getAllByRole("heading")
      .filter((heading) =>
        [
          "Affinity Petcare",
          "Stakeholders",
          "Workspace knows",
          "Recent deliverables",
          "Suggested next",
          "Ask about Affinity Petcare",
        ].includes(heading.textContent ?? ""),
      )
      .map((heading) => heading.textContent);

    expect(headings).toEqual([
      "Affinity Petcare",
      "Stakeholders",
      "Workspace knows",
      "Recent deliverables",
      "Suggested next",
      "Ask about Affinity Petcare",
    ]);
  });

  it("hides empty optional sections but keeps Workspace knows visible", () => {
    render(
      React.createElement(
        ScopeLanding,
        baseProps({
          stakeholders: [],
          deliverables: [],
          suggestions: [],
        }),
      ),
    );

    expect(screen.queryByRole("heading", { name: "Stakeholders" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Recent deliverables" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Suggested next" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Workspace knows" })).not.toBeNull();
  });
});

function baseProps(overrides: Partial<ScopeLandingProps> = {}): ScopeLandingProps {
  return {
    scope: { id: "scope-1", name: "Affinity Petcare", kind: "client" },
    stakeholders: [
      {
        id: "person-1",
        name: "Rossella D'Emilia",
        role: "Client Lead",
        preferenceQuote: "Keep the workbook editable.",
      },
    ],
    workspaceKnows: {
      rulesCount: 4,
      factsCount: 8,
      articlesCount: 2,
      lastResearchLabel: "2h, 3 sources",
    },
    deliverables: [
      {
        id: "deliverable-1",
        title: "Retailer readout",
        updatedAt: "2h",
        href: "/workspace/chat/chat-1",
      },
    ],
    suggestions: [
      {
        id: "suggestion-1",
        kind: "summarize",
        prompt: "Summarize the latest Affinity Petcare facts.",
        reason: "Uses recent scope memory.",
      },
    ],
    chat: React.createElement("section", { "aria-label": "Chat" }, [
      React.createElement("h2", { key: "h" }, "Ask about Affinity Petcare"),
    ]),
    ...overrides,
  };
}
