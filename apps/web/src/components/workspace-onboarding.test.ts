// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceOnboarding } from "@/components/workspace-onboarding";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
  }),
}));

vi.mock("@/components/workspace-upload-zone", () => ({
  WorkspaceUploadZone: () => React.createElement("div", { "data-testid": "upload-zone" }, "Drop a file here"),
}));

vi.mock("@/lib/workspace/constants", () => ({
  SUPPORTED_UPLOAD_LABEL: "PDF, DOCX, PPTX, XLSX, MD",
}));

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  mocks.push.mockClear();
  mocks.refresh.mockClear();
});

describe("WorkspaceOnboarding", () => {
  it("starts on the routed scope step and advances after a scope is named", () => {
    render(React.createElement(WorkspaceOnboarding, { initialStep: 1, routed: true }));

    expect(screen.getByText("Step 1 of 3")).not.toBeNull();
    expect(screen.getByText("What do you analyze?")).not.toBeNull();
    expect(screen.getByText("Continue").closest("button")?.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Client name"), {
      target: { value: "Affinity Petcare" },
    });
    fireEvent.click(screen.getByText("Continue"));

    expect(mocks.push).toHaveBeenCalledWith("/onboarding/2");
  });

  it("renders the seed-file step as its own URL state", () => {
    render(React.createElement(WorkspaceOnboarding, { initialStep: 2, routed: true }));

    expect(screen.getByText("Step 2 of 3")).not.toBeNull();
    expect(screen.getByText("Drop one thing that represents your work.")).not.toBeNull();
    expect(screen.getByTestId("upload-zone")).not.toBeNull();

    fireEvent.click(screen.getByText("Continue without waiting"));
    expect(mocks.push).toHaveBeenCalledWith("/onboarding/3");
  });

  it("resumes the draft on the stakeholder step after refresh", async () => {
    window.sessionStorage.setItem(
      "basquio:workspace-onboarding-draft",
      JSON.stringify({
        scopes: [{ id: "scope-1", kind: "client", name: "Affinity Petcare" }],
        stakeholders: [],
      }),
    );

    render(React.createElement(WorkspaceOnboarding, { initialStep: 3, routed: true }));

    expect(await screen.findByText("Affinity Petcare")).not.toBeNull();
    fireEvent.click(screen.getByText("Add stakeholder"));

    expect(screen.getByLabelText("Name")).not.toBeNull();
    expect(screen.getByLabelText("They prefer")).not.toBeNull();
  });
});
