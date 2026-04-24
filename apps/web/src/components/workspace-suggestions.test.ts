// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkspaceInlineSuggestions,
  WorkspaceSuggestionSurface,
} from "@/components/workspace-suggestions";
import type { WorkspaceSuggestion } from "@/lib/workspace/suggestions";

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

describe("Workspace suggestions", () => {
  it("caps card surfaces at three suggestions and dispatches prompts", () => {
    const listener = vi.fn();
    window.addEventListener("basquio:workspace-prompt", listener);
    render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement("div", { id: "workspace-chat" }),
        React.createElement(WorkspaceSuggestionSurface, {
          title: "Suggested for today",
          placement: "home",
          suggestions: suggestions(),
        }),
      ),
    );

    expect(screen.getByText("Suggested for today")).not.toBeNull();
    expect(screen.getAllByText("Use in chat")).toHaveLength(3);
    expect(screen.queryByText("Fourth prompt")).toBeNull();

    fireEvent.click(screen.getAllByText("Use in chat")[0]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail.prompt).toBe("First prompt");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    window.removeEventListener("basquio:workspace-prompt", listener);
  });

  it("suppresses dismissed suggestions for seven days", () => {
    const { rerender } = render(
      React.createElement(WorkspaceSuggestionSurface, {
        title: "Suggested next",
        placement: "scope",
        suggestions: suggestions().slice(0, 2),
      }),
    );

    fireEvent.click(screen.getByLabelText("Dismiss First prompt"));

    expect(screen.queryByText("First prompt")).toBeNull();

    rerender(
      React.createElement(WorkspaceSuggestionSurface, {
        title: "Suggested next",
        placement: "scope",
        suggestions: suggestions().slice(0, 2),
      }),
    );

    expect(screen.queryByText("First prompt")).toBeNull();
    expect(screen.getByText("Second prompt")).not.toBeNull();
  });

  it("inline chips send one follow-up and collapse", () => {
    const onSend = vi.fn();
    render(
      React.createElement(WorkspaceInlineSuggestions, {
        suggestions: suggestions(),
        onSend,
      }),
    );

    const chips = screen.getAllByRole("button");
    expect(chips).toHaveLength(3);

    fireEvent.click(chips[0]);

    expect(onSend).toHaveBeenCalledWith("First prompt");
    expect(screen.queryByLabelText("Suggested next actions")).toBeNull();
  });
});

function suggestions(): WorkspaceSuggestion[] {
  return [
    {
      id: "s1",
      kind: "investigate",
      prompt: "First prompt",
      reason: "First reason",
    },
    {
      id: "s2",
      kind: "summarize",
      prompt: "Second prompt",
      reason: "Second reason",
    },
    {
      id: "s3",
      kind: "narrate",
      prompt: "Third prompt",
      reason: "Third reason",
    },
    {
      id: "s4",
      kind: "retry",
      prompt: "Fourth prompt",
      reason: "Fourth reason",
    },
  ];
}
