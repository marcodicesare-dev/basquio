// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceInteractionLayer } from "@/components/workspace-interaction-layer";

const mocks = vi.hoisted(() => ({
  pathname: "/workspace",
  search: "",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

beforeEach(() => {
  mocks.pathname = "/workspace";
  mocks.search = "";
  window.history.pushState({}, "", "/workspace");
});

afterEach(() => {
  cleanup();
});

describe("WorkspaceInteractionLayer", () => {
  it("shows route progress immediately for workspace links and clears on route change", () => {
    const { container, rerender } = render(React.createElement(Fixture));

    fireEvent.click(container.querySelector("a")!);

    expect(container.querySelector(".wbeta-route-progress-on")).not.toBeNull();

    mocks.pathname = "/workspace/sources";
    rerender(React.createElement(Fixture));

    expect(container.querySelector(".wbeta-route-progress-on")).toBeNull();
  });

  it("ignores external links", () => {
    const { container } = render(
      React.createElement(
        "div",
        { className: "wbeta-shell" },
        React.createElement(WorkspaceInteractionLayer),
        React.createElement("a", { href: "https://example.com", onClick: preventNavigation }, "External"),
      ),
    );

    fireEvent.click(container.querySelector("a")!);

    expect(container.querySelector(".wbeta-route-progress-on")).toBeNull();
  });
});

function Fixture() {
  return React.createElement(
    "div",
    { className: "wbeta-shell" },
    React.createElement(WorkspaceInteractionLayer),
    React.createElement("a", { href: "/workspace/sources", onClick: preventNavigation }, "Sources"),
  );
}

function preventNavigation(event: React.MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
}
