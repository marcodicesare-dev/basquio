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

    const link = screen.getByText("Affinity Petcare").closest("a");
    expect(link?.getAttribute("href")).toBe("/workspace/scope/client/affinity-petcare");
    fireEvent.click(link!);

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
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

    const link = screen.getByText("Affinity Petcare").closest("a");
    expect(link?.getAttribute("href")).toBe("/workspace/scope/client/affinity-petcare");
    fireEvent.click(link!);

    expect(startViewTransition).toHaveBeenCalledTimes(0);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("renders localized chrome labels and closes mobile navigation on route clicks", () => {
    const onNavigate = vi.fn();
    render(
      React.createElement(WorkspaceSidebar, {
        tree: {
          client: [scope("scope-1", "client", "Affinity Petcare", "affinity-petcare")],
          category: [],
          function: [],
          system: [],
        },
        counts: {},
        copy: {
          home: "Home",
          clients: "Clienti",
          categories: "Categorie",
          functions: "Funzioni",
          sources: "Fonti",
          people: "Persone",
          memory: "Memoria",
          newClient: "Nuovo cliente",
          newCategory: "Nuova categoria",
          newFunction: "Nuova funzione",
          clientName: "Nome cliente",
          categoryName: "Nome categoria",
          functionName: "Nome funzione",
          add: "Aggiungi",
          adding: "Aggiungo",
          cancel: "Annulla",
          items: "elementi",
        },
        onNavigate,
      }),
    );

    expect(screen.getByText("Clienti")).not.toBeNull();
    expect(screen.getByText("Nuovo cliente")).not.toBeNull();

    const link = screen.getByText("Affinity Petcare").closest("a");
    expect(link?.getAttribute("href")).toBe("/workspace/scope/client/affinity-petcare");
    fireEvent.click(link!);

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("marks Sources active on the source library page", () => {
    mocks.pathname = "/workspace/sources";

    render(
      React.createElement(WorkspaceSidebar, {
        tree: {
          client: [],
          category: [],
          function: [],
          system: [],
        },
        counts: {},
      }),
    );

    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Sources" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("marks the current recent chat instead of Home on chat pages", () => {
    mocks.pathname = "/workspace/chat/chat-1";

    render(
      React.createElement(WorkspaceSidebar, {
        tree: {
          client: [],
          category: [],
          function: [],
          system: [],
        },
        counts: {},
        recentConversations: [
          {
            id: "chat-1",
            title: "Retailer readout",
            lastMessageAt: "2026-04-24T12:00:00.000Z",
          },
        ],
      }),
    );

    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: /Retailer readout/ }).getAttribute("aria-current")).toBe(
      "page",
    );
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
