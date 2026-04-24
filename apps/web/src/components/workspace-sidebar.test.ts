// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import type { WorkspaceScope } from "@/lib/workspace/types";

const mocks = vi.hoisted(() => ({
  pathname: "/workspace",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({
    push: mocks.push,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/workspace/constants", () => ({
  SCOPE_KIND_LABELS: {
    client: "Clients",
    category: "Categories",
    function: "Functions",
    system: "System",
  },
}));

beforeEach(() => {
  mocks.pathname = "/workspace";
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false }),
  });
});

afterEach(() => {
  cleanup();
  mocks.push.mockClear();
  Reflect.deleteProperty(document, "startViewTransition");
});

describe("WorkspaceSidebar", () => {
  it("starts a view transition when navigating to a scope", () => {
    const startViewTransition = vi.fn((callback: () => void) => callback());
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    render(
      React.createElement(WorkspaceSidebar, {
        tree: {
          client: [scope("scope-1", "client", "Affinity Petcare", "affinity-petcare")],
          category: [],
          function: [],
          system: [],
        },
        counts: {},
      }),
    );

    fireEvent.click(screen.getByText("Affinity Petcare"));

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("/workspace/scope/client/affinity-petcare");
  });

  it("falls back to direct navigation when reduced motion is enabled", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true }),
    });
    const startViewTransition = vi.fn((callback: () => void) => callback());
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    render(
      React.createElement(WorkspaceSidebar, {
        tree: {
          client: [scope("scope-1", "client", "Affinity Petcare", "affinity-petcare")],
          category: [],
          function: [],
          system: [],
        },
        counts: {},
      }),
    );

    fireEvent.click(screen.getByText("Affinity Petcare"));

    expect(startViewTransition).toHaveBeenCalledTimes(0);
    expect(mocks.push).toHaveBeenCalledWith("/workspace/scope/client/affinity-petcare");
  });
});

function scope(id: string, kind: WorkspaceScope["kind"], name: string, slug: string): WorkspaceScope {
  return {
    id,
    workspace_id: "workspace",
    kind,
    name,
    slug,
    parent_scope_id: null,
    metadata: {},
    created_at: "2026-04-24T00:00:00.000Z",
  };
}
