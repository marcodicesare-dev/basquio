// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceHomeDashboard } from "@/components/workspace-home-dashboard";

type DashboardProps = ComponentProps<typeof WorkspaceHomeDashboard>;
const scrollIntoView = vi.fn();

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  cleanup();
  scrollIntoView.mockClear();
});

describe("WorkspaceHomeDashboard", () => {
  it("renders the populated workspace home with capped suggestions and chat", () => {
    render(React.createElement(WorkspaceHomeDashboard, baseProps()));

    expect(screen.getByText("Good morning, Marco")).not.toBeNull();
    expect(screen.getByText("7")).not.toBeNull();
    expect(screen.getByText("Affinity Petcare")).not.toBeNull();
    expect(screen.getByText("Retailer margin readout")).not.toBeNull();
    expect(screen.getByTestId("workspace-chat")).not.toBeNull();
    expect(screen.getAllByText("Use in chat")).toHaveLength(3);
    expect(screen.queryByText("Fourth suggestion")).toBeNull();
  });

  it("dispatches a composer prefill event from suggested prompts", () => {
    const listener = vi.fn();
    window.addEventListener("basquio:workspace-prompt", listener);
    render(React.createElement(WorkspaceHomeDashboard, baseProps()));

    fireEvent.click(screen.getAllByText("Use in chat")[0]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail.prompt).toBe(
      "Find the pressure on Affinity Petcare margins.",
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    window.removeEventListener("basquio:workspace-prompt", listener);
  });

  it("shows sparse workspace guidance when core context is missing", () => {
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

    expect(screen.getByText("Add the pieces that make answers feel yours.")).not.toBeNull();
    expect(screen.getByText("Add a stakeholder")).not.toBeNull();
    expect(screen.getByText("Upload one brief")).not.toBeNull();
    expect(screen.getByText("Teach one rule")).not.toBeNull();
    expect(screen.getByText("Stats appear after a week of activity.")).not.toBeNull();
  });

  it("renders the brand-new onboarding state without the chat surface", () => {
    render(
      React.createElement(
        WorkspaceHomeDashboard,
        baseProps({
          state: "brand-new",
          activeScopes: [],
          conversations: [],
          entityGroups: [],
          suggestions: [],
          setup: React.createElement("div", { "data-testid": "workspace-setup" }, "Setup flow"),
        }),
      ),
    );

    expect(screen.getByText("Welcome to Basquio")).not.toBeNull();
    expect(screen.getByText("Set up workspace")).not.toBeNull();
    expect(screen.getByTestId("workspace-setup")).not.toBeNull();
    expect(screen.queryByTestId("workspace-chat")).toBeNull();
  });
});

function baseProps(overrides: Partial<DashboardProps> = {}): DashboardProps {
  return {
    greeting: "Good morning, Marco",
    learnedCount: 7,
    state: "populated",
    suggestions: [
      {
        id: "s1",
        kind: "investigate",
        prompt: "Find the pressure on Affinity Petcare margins.",
        reason: "Combines recent chats with client memory.",
      },
      {
        id: "s2",
        kind: "summarize",
        prompt: "Summarize last week's category updates.",
        reason: "Uses the newest documents in the workspace.",
      },
      {
        id: "s3",
        kind: "narrate",
        prompt: "Draft the executive storyline for retail growth.",
        reason: "Starts from saved stakeholder preferences.",
      },
      {
        id: "s4",
        kind: "retry",
        prompt: "Fourth suggestion",
        reason: "This should stay hidden on the home dashboard.",
      },
    ],
    activeScopes: [
      {
        id: "scope-1",
        name: "Affinity Petcare",
        kind: "client",
        href: "/workspace/scope/client/affinity-petcare",
        memoryCount: 2,
        factCount: 8,
        deliverableCount: 1,
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
