// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceSkeleton } from "@/components/workspace-skeleton";

afterEach(() => {
  cleanup();
});

describe("WorkspaceSkeleton", () => {
  it("renders line skeletons with fixed width", () => {
    render(React.createElement(WorkspaceSkeleton, { density: "line", width: "60%" }));

    const skeleton = screen.getByRole("status", { name: "Loading content" });
    expect(skeleton.className).toContain("wbeta-skeleton-line");
    expect((skeleton as HTMLElement).style.width).toBe("60%");
  });

  it("caps grid skeleton cells at nine", () => {
    render(React.createElement(WorkspaceSkeleton, { density: "grid", rows: 4, cols: 4 }));

    expect(document.querySelectorAll(".wbeta-skeleton-cell")).toHaveLength(9);
  });
});
