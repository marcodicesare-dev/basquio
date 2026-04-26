// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScopeCommandPalette } from "@/components/scope-command-palette";

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

describe("ScopeCommandPalette", () => {
  it("traps focus, restores focus, and supports keyboard result navigation", async () => {
    render(
      React.createElement(ScopeCommandPalette, {
        scopeName: "Affinity Petcare",
        actions: [
          {
            id: "memory",
            group: "Open",
            label: "Affinity knowledge",
            href: "/workspace/memory",
          },
          {
            id: "deliverable",
            group: "Chat",
            label: "Retailer readout",
            href: "/workspace/chat/chat-1",
          },
        ],
      }),
    );

    const trigger = screen.getByRole("button", {
      name: "Open workspace search for Affinity Petcare",
    });
    trigger.focus();
    fireEvent.click(trigger);

    const input = await screen.findByLabelText("Search workspace");
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(mocks.push).toHaveBeenCalledWith("/workspace/chat/chat-1");

    fireEvent.click(trigger);
    const reopenedInput = await screen.findByLabelText("Search workspace");
    await waitFor(() => expect(document.activeElement).toBe(reopenedInput));

    const links = screen.getAllByRole("link");
    const lastLink = links[links.length - 1];
    lastLink.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(document.activeElement).toBe(reopenedInput);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
