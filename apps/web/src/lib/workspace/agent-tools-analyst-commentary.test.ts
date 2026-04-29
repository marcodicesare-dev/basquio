import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const messagesCreate = vi.fn();
  const Anthropic = vi.fn(() => ({
    beta: {
      messages: {
        create: messagesCreate,
      },
    },
  }));
  return {
    Anthropic,
    messagesCreate,
    fetchAttachedFilesByDocumentIds: vi.fn(),
    confirmAnthropicFile: vi.fn(),
    uploadFileToAnthropic: vi.fn(),
    setDocumentAnthropicFileId: vi.fn(),
  };
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: mocks.Anthropic,
}));

vi.mock("@/lib/workspace/documents", () => ({
  fetchAttachedFilesByDocumentIds: mocks.fetchAttachedFilesByDocumentIds,
}));

vi.mock("@/lib/workspace/anthropic-files", () => ({
  confirmAnthropicFile: mocks.confirmAnthropicFile,
  uploadFileToAnthropic: mocks.uploadFileToAnthropic,
}));

vi.mock("@/lib/workspace/db", () => ({
  setDocumentAnthropicFileId: mocks.setDocumentAnthropicFileId,
}));

import { analystCommentaryTool } from "./agent-tools-analyst-commentary";

const ctx = {
  workspaceId: "workspace-1",
  organizationId: "workspace-1",
  currentScopeId: null,
  conversationId: "11111111-1111-4111-8111-111111111111",
  userEmail: "marco@example.com",
  userId: "00000000-0000-0000-0000-000000000001",
};

const documentIds = [
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  mocks.Anthropic.mockClear();
  mocks.messagesCreate.mockReset();
  mocks.fetchAttachedFilesByDocumentIds.mockReset();
  mocks.confirmAnthropicFile.mockReset();
  mocks.uploadFileToAnthropic.mockReset();
  mocks.setDocumentAnthropicFileId.mockReset();
  mocks.confirmAnthropicFile.mockResolvedValue(true);
  mocks.uploadFileToAnthropic.mockResolvedValue("file-uploaded-2");
  mocks.setDocumentAnthropicFileId.mockResolvedValue(undefined);
  mocks.messagesCreate.mockResolvedValue({
    content: [{ type: "text", text: "Category pressure is moving from price to mix [guide.pdf]." }],
  });
});

async function executeCommentary() {
  const toolDef = analystCommentaryTool(ctx) as unknown as {
    execute: (input: {
      document_ids: string[];
      objective: string;
      output_format: "analyst_markdown" | "slide_speaker_notes" | "inline_bullets";
      scope_context: string | null;
    }) => Promise<unknown>;
  };
  return toolDef.execute({
    document_ids: documentIds,
    objective: "Comment slide 3 using the guide and prior deck.",
    output_format: "analyst_markdown",
    scope_context: "Client: MDLZ Italia",
  });
}

describe("analystCommentaryTool", () => {
  it("returns commentary when files are accessible", async () => {
    mocks.fetchAttachedFilesByDocumentIds.mockResolvedValue([
      {
        documentId: documentIds[0],
        filename: "guide.pdf",
        fileType: "pdf",
        storagePath: "docs/guide.pdf",
        anthropicFileId: "file-existing-1",
        buffer: Buffer.from("guide"),
        contentType: "application/pdf",
      },
      {
        documentId: documentIds[1],
        filename: "slides.pptx",
        fileType: "pptx",
        storagePath: "docs/slides.pptx",
        anthropicFileId: null,
        buffer: Buffer.from("slides"),
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      },
    ]);

    const result = await executeCommentary();

    expect(result).toEqual({
      commentary: "Category pressure is moving from price to mix [guide.pdf].",
      file_names: ["guide.pdf", "slides.pptx"],
      model: "claude-sonnet-4-6",
      output_format: "analyst_markdown",
    });
    expect(mocks.fetchAttachedFilesByDocumentIds).toHaveBeenCalledWith("workspace-1", documentIds);
    expect(mocks.uploadFileToAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "slides.pptx",
      }),
    );
    expect(mocks.setDocumentAnthropicFileId).toHaveBeenCalledWith(documentIds[1], "file-uploaded-2");
    expect(mocks.messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-6",
        betas: ["files-api-2025-04-14", "code-execution-2025-08-25"],
      }),
    );
    const call = mocks.messagesCreate.mock.calls[0]?.[0];
    expect(call.messages[0].content).toEqual(
      expect.arrayContaining([
        { type: "container_upload", file_id: "file-existing-1" },
        { type: "container_upload", file_id: "file-uploaded-2" },
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Objective: Comment slide 3"),
        }),
      ]),
    );
  });

  it("returns a structured error when no files match the workspace", async () => {
    mocks.fetchAttachedFilesByDocumentIds.mockResolvedValue([]);

    const result = await executeCommentary();

    expect(result).toEqual({
      error: "No indexed, accessible files found for the given document IDs.",
    });
    expect(mocks.messagesCreate).not.toHaveBeenCalled();
  });
});
