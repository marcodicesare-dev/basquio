// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceDocumentList } from "@/components/workspace-document-list";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

type WorkspaceDocumentListProps = ComponentProps<typeof WorkspaceDocumentList>;
type DocumentRow = WorkspaceDocumentListProps["documents"][number];

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ kind: "text", text: "Category growth is driven by reusable files." }),
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkspaceDocumentList", () => {
  it("previews the selected repository document and exposes a download action", async () => {
    render(React.createElement(WorkspaceDocumentList, { documents: [documentRow()] }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspace/documents/11111111-1111-4111-8111-111111111111/preview",
        expect.objectContaining({ headers: { accept: "application/json" } }),
      );
    });

    expect(await screen.findByText("Category growth is driven by reusable files.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe(
      "/api/workspace/documents/11111111-1111-4111-8111-111111111111/download?download=1",
    );
  });

  it("switches to an inline pdf preview without refetching text preview", async () => {
    const pdf = documentRow({
      id: "22222222-2222-4222-8222-222222222222",
      filename: "Coffee outlook.pdf",
      file_type: "pdf",
    });
    render(React.createElement(WorkspaceDocumentList, { documents: [documentRow(), pdf] }));

    fireEvent.click(screen.getByRole("button", { name: /Coffee outlook\.pdf/i }));

    expect(
      screen.getByTitle("Preview of Coffee outlook.pdf").getAttribute("src"),
    ).toBe("/api/workspace/documents/22222222-2222-4222-8222-222222222222/download");
  });
});

function documentRow(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspace_id: "15cc947e-70cb-455a-b0df-d8c34b760d71",
    filename: "Coffee repository.csv",
    file_type: "csv",
    file_size_bytes: 128_000,
    storage_path: "workspace/coffee.csv",
    uploaded_by: "marco@basquio.com",
    uploaded_by_user_id: "user-1",
    upload_context: null,
    status: "indexed",
    chunk_count: 4,
    page_count: null,
    error_message: null,
    metadata: {},
    created_at: "2026-04-25T08:00:00.000Z",
    inline_excerpt: "Category growth is driven by reusable files.",
    anthropic_file_id: null,
    ...overrides,
  };
}
