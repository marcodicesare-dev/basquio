// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React, { type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceHomeDashboard } from "@/components/workspace-home-dashboard";

type DashboardProps = ComponentProps<typeof WorkspaceHomeDashboard>;
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

describe("WorkspaceHomeDashboard", () => {
  it("renders the populated workspace home with capped suggestions and chat", () => {
    render(React.createElement(WorkspaceHomeDashboard, baseProps()));

    expect(screen.getByTestId("workspace-chat")).not.toBeNull();
    expect(screen.queryByText("Suggested for today")).toBeNull();
    expect(screen.queryByText("Good morning, Marco")).toBeNull();
  });

  it("renders workspace chat as the only main surface", () => {
    render(React.createElement(WorkspaceHomeDashboard, baseProps()));

    const home = document.querySelector(".wbeta-home");
    const chat = screen.getByTestId("workspace-chat").parentElement;

    expect(home?.children).toHaveLength(1);
    expect(home?.children[0]).toBe(chat);
  });

  it("keeps sparse workspaces chat-first", () => {
    render(
      React.createElement(
        WorkspaceHomeDashboard,
        baseProps({
          state: "sparse",
          learnedCount: 0,
          weeklyStats: {
            deliverables: 0,
            facts: 0,
            documents: 0,
            memories: 0,
            estimatedHoursSaved: 1,
            visible: false,
          },
        }),
      ),
    );

    expect(screen.getByTestId("workspace-chat")).not.toBeNull();
    expect(screen.queryByText("Add the pieces that make answers feel yours.")).toBeNull();
  });

  it("renders the brand-new onboarding entry without the chat surface", () => {
    render(
      React.createElement(
        WorkspaceHomeDashboard,
        baseProps({
          state: "brand-new",
          activeScopes: [],
          conversations: [],
          entityGroups: [],
        }),
      ),
    );

    expect(screen.getByText("Welcome to Basquio")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Set up workspace" }).getAttribute("href")).toBe(
      "/onboarding/1",
    );
    expect(screen.queryByTestId("workspace-chat")).toBeNull();
  });
});

function baseProps(overrides: Partial<DashboardProps> = {}): DashboardProps {
  return {
    greeting: "Good morning, Marco",
    learnedCount: 7,
    state: "populated",
    activeScopes: [
      {
        id: "scope-1",
        name: "Affinity Petcare",
        kind: "client",
        href: "/workspace/scope/client/affinity-petcare",
        memoryCount: 2,
        factCount: 8,
        deliverableCount: 1,
        lastActivityLabel: "2h",
      },
    ],
    conversations: [
      {
        id: "chat-1",
        title: "Retailer margin readout",
        lastMessageLabel: "2h",
        href: "/workspace/chat/chat-1",
      },
    ],
    entityGroups: [
      {
        label: "People",
        count: 6,
      },
      {
        label: "Categories",
        count: 4,
      },
    ],
    weeklyStats: {
      deliverables: 3,
      facts: 12,
      documents: 5,
      memories: 7,
      estimatedHoursSaved: 11,
      visible: true,
    },
    chat: React.createElement("div", { "data-testid": "workspace-chat" }, "Chat surface"),
    setup: null,
    ...overrides,
  };
}
