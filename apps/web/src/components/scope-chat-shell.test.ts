// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import React, { type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScopeChatShell, buildContextLine } from "@/components/scope-chat-shell";

type ScopeChatShellProps = ComponentProps<typeof ScopeChatShell>;

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
  }),
}));

afterEach(() => {
  cleanup();
  mocks.push.mockClear();
});

describe("ScopeChatShell", () => {
  it("makes chat the primary pane before the context rail", () => {
    render(React.createElement(ScopeChatShell, baseProps()));

    const chat = screen.getByRole("region", { name: "Chat with Affinity Petcare" });
    const layout = chat.parentElement;
    expect(layout?.children[1]).toBe(chat);
    expect(layout?.children[2]).toBe(
      screen.getByRole("complementary", { name: "Workspace context" }),
    );
  });

  it("moves suggested next into composer pills instead of a card section", () => {
    render(React.createElement(ScopeChatShell, baseProps()));

    const chat = screen.getByRole("region", { name: "Chat with Affinity Petcare" });
    expect(within(chat).getByRole("button", { name: "Summarize Affinity Petcare" })).not.toBeNull();
    expect(screen.getAllByRole("heading", { name: "Try next" }).length).toBeGreaterThan(0);
    expect(document.querySelector(".wbeta-suggestion-card")).toBeNull();
  });

  it("renders rail context without the retired briefing stack classes", () => {
    render(React.createElement(ScopeChatShell, baseProps()));

    expect(screen.getAllByRole("heading", { name: "Recent chats" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Context").length).toBeGreaterThan(0);
    expect(screen.getAllByText("People").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Chats").length).toBeGreaterThan(0);
    expect(screen.queryByText("Rules")).toBeNull();
    expect(screen.queryByText("Facts")).toBeNull();
    expect(screen.queryByText("Articles")).toBeNull();
    expect(document.querySelector(".wbeta-scope-landing")).toBeNull();
    expect(document.querySelector(".wbeta-scope-three-col")).toBeNull();
  });

  it("keeps the full rail context available inside the mobile strip", () => {
    render(React.createElement(ScopeChatShell, baseProps()));

    const mobileContext = document.querySelector(".wbeta-scope-mobile-context") as HTMLElement;
    const mobile = within(mobileContext);
    expect(mobile.getByText("Saved context · 1 recent chat")).not.toBeNull();
    expect(mobile.getByRole("complementary", { name: "Mobile scope context" })).not.toBeNull();
    expect(mobile.getByRole("link", { name: /Retailer readout/ })).not.toBeNull();
    expect(mobile.getByRole("button", { name: /Summarize Affinity Petcare/ })).not.toBeNull();
    expect(mobile.getByRole("complementary", { name: "Workspace memory" })).not.toBeNull();
  });

  it("uses plain language in the scope context line", () => {
    expect(
      buildContextLine("Affinity Petcare", {
        rulesCount: 4,
        factsCount: 0,
        articlesCount: 0,
        lastResearchLabel: "21h, 0 sources",
      }),
    ).toBe(
      "Ask about Affinity Petcare. I will use saved context and recent work. Last updated 21h, 0 sources.",
    );
  });
});

function baseProps(overrides: Partial<ScopeChatShellProps> = {}): ScopeChatShellProps {
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
        prompt: "Summarize Affinity Petcare",
        reason: "Uses recent scope memory.",
      },
    ],
    commandActions: [
      {
        id: "memory",
        group: "Open",
        label: "Affinity memory",
        href: "/workspace/memory",
      },
    ],
    chat: React.createElement("section", { id: "workspace-chat", "aria-label": "Chat" }, [
      React.createElement("div", { key: "pills", className: "wbeta-ai-chat-prompt-pills" }, [
        React.createElement("button", { key: "suggestion", type: "button" }, "Summarize Affinity Petcare"),
      ]),
    ]),
    memoryAside: React.createElement("aside", { "aria-label": "Workspace memory" }, "Memory"),
    locale: "en",
    ...overrides,
  };
}
