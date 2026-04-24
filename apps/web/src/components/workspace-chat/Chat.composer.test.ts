// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

const mocks = vi.hoisted(() => ({
  textareaProps: [] as Array<Record<string, unknown>>,
  sendMessage: vi.fn(),
  stop: vi.fn(),
  regenerate: vi.fn(),
  status: "ready" as string,
  messages: [] as Array<unknown>,
}));
const scrollIntoView = vi.fn();
const scrollTo = vi.fn();

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: scrollIntoView,
});

Object.defineProperty(HTMLElement.prototype, "scrollTo", {
  configurable: true,
  value: scrollTo,
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: mocks.messages,
    sendMessage: mocks.sendMessage,
    status: mocks.status,
    stop: mocks.stop,
    regenerate: mocks.regenerate,
  }),
}));

vi.mock("react-textarea-autosize", () => {
  const TextareaAutosizeMock = React.forwardRef<HTMLTextAreaElement, Record<string, unknown>>((props, ref) => {
    mocks.textareaProps.push(props);
    const value = String(props.value ?? "");
    const lineCount = Math.max(1, value.split("\n").length);
    const rows = Math.min(Number(props.maxRows ?? 10), Math.max(Number(props.minRows ?? 1), lineCount));
    return React.createElement("textarea", {
      ref,
      id: props.id,
      className: props.className,
      placeholder: props.placeholder,
      value: props.value,
      disabled: props.disabled,
      "aria-label": "Message",
      style: { height: `${rows * 22}px` },
      onChange: props.onChange,
      onKeyDown: props.onKeyDown,
      onPaste: props.onPaste,
    });
  });
  TextareaAutosizeMock.displayName = "TextareaAutosizeMock";
  return { default: TextareaAutosizeMock };
});

vi.mock("@/components/workspace-generation-drawer", () => ({
  WorkspaceGenerationDrawer: () => null,
}));

vi.mock("@/components/workspace-generation-status", () => ({
  WorkspaceGenerationStatus: () => null,
}));

vi.mock("@/lib/workspace/upload-client", () => ({
  uploadWorkspaceFile: vi.fn(),
}));

import { WorkspaceChat } from "@/components/workspace-chat/Chat";
import { uploadWorkspaceFile } from "@/lib/workspace/upload-client";

const uploadWorkspaceFileMock = vi.mocked(uploadWorkspaceFile);

afterEach(() => {
  cleanup();
  mocks.textareaProps.length = 0;
  mocks.sendMessage.mockClear();
  mocks.stop.mockClear();
  mocks.regenerate.mockClear();
  uploadWorkspaceFileMock.mockReset();
  scrollIntoView.mockClear();
  scrollTo.mockClear();
  mocks.status = "ready";
  mocks.messages = [];
});

describe("WorkspaceChat composer", () => {
  it("uses an autosizing textarea from one to ten rows", () => {
    render(React.createElement(WorkspaceChat, {}));

    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    const initialHeight = parseFloat(textarea.style.height);
    const latestProps = mocks.textareaProps.at(-1);

    expect(latestProps?.minRows).toBe(1);
    expect(latestProps?.maxRows).toBe(10);
    expect(latestProps).not.toHaveProperty("rows");

    fireEvent.change(textarea, {
      target: { value: "one\ntwo\nthree\nfour\nfive" },
    });

    const grownHeight = parseFloat(textarea.style.height);
    expect(grownHeight).toBeGreaterThan(initialHeight * 3);
    expect(grownHeight).toBeLessThanOrEqual(initialHeight * 10);
  });

  it("prefills the composer from workspace home suggested prompts", () => {
    render(React.createElement(WorkspaceChat, {}));

    fireEvent(
      window,
      new CustomEvent("basquio:workspace-prompt", {
        detail: { prompt: "Summarize Affinity Petcare margin pressure." },
      }),
    );

    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
      "Summarize Affinity Petcare margin pressure.",
    );
  });

  it("shows short labels for scoped prompt chips while keeping the full prompt", () => {
    render(
      React.createElement(WorkspaceChat, {
        scopeName: "Affinity Petcare",
        promptSuggestions: [
          {
            id: "suggestion-1",
            kind: "investigate",
            prompt: "Use Rossella feedback for the next Affinity Petcare brief.",
            reason: "Saved memory updated 21 hours ago.",
          },
        ],
      }),
    );

    const chip = screen.getByRole("button", { name: "Use Rossella feedback" });
    fireEvent.click(chip);

    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
      "Use Rossella feedback for the next Affinity Petcare brief.",
    );
  });

  it("submits on Enter without requiring Command Enter", async () => {
    render(React.createElement(WorkspaceChat, { scopeName: "Affinity Petcare" }));

    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: "What changed in this account?" },
    });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalledWith({ text: "What changed in this account?" });
    });
  });

  it("keeps Shift Enter for multiline drafting", () => {
    render(React.createElement(WorkspaceChat, { scopeName: "Affinity Petcare" }));

    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: "Line one" },
    });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter", shiftKey: true });

    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("does not submit while an IME composition Enter event is resolving", () => {
    render(React.createElement(WorkspaceChat, { scopeName: "Affinity Petcare" }));

    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: "入力中" },
    });
    fireEvent.keyDown(textarea, {
      key: "Enter",
      code: "Enter",
      keyCode: 229,
      which: 229,
    });

    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("shows an immediate thinking state after a submitted prompt", async () => {
    const { rerender } = render(React.createElement(WorkspaceChat, { scopeName: "Affinity Petcare" }));

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "What changed in this account?" },
    });
    fireEvent.submit(document.querySelector(".wbeta-ai-chat-form") as HTMLFormElement);
    await waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalledWith({ text: "What changed in this account?" });
    });

    mocks.status = "submitted";
    rerender(React.createElement(WorkspaceChat, { scopeName: "Affinity Petcare" }));

    expect(screen.getByText("What changed in this account?")).not.toBeNull();
    expect(screen.getByText("Thinking...")).not.toBeNull();
    expect(screen.getByText(/^\d+\.\ds$/)).not.toBeNull();
  });

  it("keeps activity visible while an assistant placeholder has no text", async () => {
    const { rerender } = render(React.createElement(WorkspaceChat, { scopeName: "Affinity Petcare" }));

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "What is the next move?" },
    });
    fireEvent.submit(document.querySelector(".wbeta-ai-chat-form") as HTMLFormElement);

    mocks.status = "streaming";
    mocks.messages = [
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "What is the next move?" }],
      },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [],
      },
    ];
    rerender(React.createElement(WorkspaceChat, { scopeName: "Affinity Petcare" }));

    await waitFor(() => {
      expect(screen.getByText("Thinking...")).not.toBeNull();
    });
    expect(screen.getAllByText("What is the next move?")).toHaveLength(1);
  });

  it("keeps the latest streamed answer in view as it grows", async () => {
    const { rerender } = render(React.createElement(WorkspaceChat, { scopeName: "Affinity Petcare" }));
    scrollTo.mockClear();

    mocks.status = "streaming";
    mocks.messages = [
      {
        id: "user-3",
        role: "user",
        parts: [{ type: "text", text: "Summarize the account." }],
      },
      {
        id: "assistant-3",
        role: "assistant",
        parts: [{ type: "text", text: "First token." }],
      },
    ];
    rerender(React.createElement(WorkspaceChat, { scopeName: "Affinity Petcare" }));

    await waitFor(() => {
      expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "auto" }));
    });
    const firstCallCount = scrollTo.mock.calls.length;

    mocks.messages = [
      mocks.messages[0],
      {
        id: "assistant-3",
        role: "assistant",
        parts: [{ type: "text", text: "First token. More streamed answer text." }],
      },
    ];
    rerender(React.createElement(WorkspaceChat, { scopeName: "Affinity Petcare" }));

    await waitFor(() => {
      expect(scrollTo.mock.calls.length).toBeGreaterThan(firstCallCount);
    });
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "auto" }));
  });

  it("appends the pending turn at the bottom of an existing chat", async () => {
    mocks.messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Earlier question" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Earlier answer" }],
      },
    ];
    render(React.createElement(WorkspaceChat, { scopeName: "Affinity Petcare" }));

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "What changed now?" },
    });
    fireEvent.submit(document.querySelector(".wbeta-ai-chat-form") as HTMLFormElement);

    await waitFor(() => {
      const renderedMessages = Array.from(document.querySelectorAll(".wbeta-ai-msg")).map(
        (message) => message.textContent ?? "",
      );
      expect(renderedMessages.at(-2)).toContain("What changed now?");
      expect(renderedMessages.at(-1)).toContain("Thinking...");
    });
  });

  it("keeps an uploaded file attached when memory indexing fails", async () => {
    uploadWorkspaceFileMock.mockResolvedValue({
      id: "d135e80d-2f1a-4760-95c3-a8393ef2dd68",
      status: "failed",
      deduplicated: true,
      fileName: "2026_Tablets shifting FY 2025.pptx",
      attachedToConversation: true,
    });

    render(React.createElement(WorkspaceChat, { scopeName: "MDLZ" }));

    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["fake deck"], "2026_Tablets shifting FY 2025.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadWorkspaceFileMock).toHaveBeenCalledWith(file, {
        conversationId: expect.any(String),
        scopeId: null,
        origin: "chat-drop",
      });
    });

    expect(await screen.findByText("2026_Tablets shifting FY 2025.pptx")).not.toBeNull();
    expect(screen.getByText(/attached, memory indexing needs retry/i)).not.toBeNull();
    expect(screen.queryByText(/upload failed/i)).toBeNull();
    expect(screen.getByRole("button", { name: /retry indexing 2026_Tablets/i })).not.toBeNull();
  });

  it("does not label a file as attached when conversation attachment fails", async () => {
    uploadWorkspaceFileMock.mockResolvedValue({
      id: "5a7f5d9d-8e49-405b-8a78-61563a071776",
      status: "processing",
      deduplicated: false,
      fileName: "NIQ Shifting Analysis - Product Template Guide.pdf",
      attachedToConversation: false,
    });

    render(React.createElement(WorkspaceChat, { scopeName: "MDLZ" }));

    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["fake pdf"], "NIQ Shifting Analysis - Product Template Guide.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("NIQ Shifting Analysis - Product Template Guide.pdf")).not.toBeNull();
    expect(screen.getByText(/saved to workspace, chat attach failed/i)).not.toBeNull();
    expect(screen.queryByText(/attached, memory indexing/i)).toBeNull();
  });

  it("uploads pasted screenshots as chat-paste attachments", async () => {
    uploadWorkspaceFileMock.mockResolvedValue({
      id: "fcbf595a-f076-445c-9c7f-6b31730ab1ec",
      status: "processing",
      deduplicated: false,
      fileName: "screenshot.png",
      attachedToConversation: true,
    });

    render(React.createElement(WorkspaceChat, { scopeName: "MDLZ" }));

    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    const pasted = new File(["fake image"], "image.png", { type: "image/png" });
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => pasted,
          },
        ],
        files: [],
      },
    });

    await waitFor(() => {
      expect(uploadWorkspaceFileMock).toHaveBeenCalled();
    });

    const uploadedFile = uploadWorkspaceFileMock.mock.calls[0]?.[0] as File;
    expect(uploadedFile.name).toMatch(/^screenshot-\d{4}-\d{2}-\d{2}-\d{6}\.png$/);
    expect(uploadWorkspaceFileMock.mock.calls[0]?.[1]).toMatchObject({
      conversationId: expect.any(String),
      scopeId: null,
      origin: "chat-paste",
    });
    expect(await screen.findByRole("button", { name: /preview screenshot-/i })).not.toBeNull();
  });

  it("opens pasted image attachments in a full-screen preview", async () => {
    uploadWorkspaceFileMock.mockResolvedValue({
      id: "fcbf595a-f076-445c-9c7f-6b31730ab1ec",
      status: "indexed",
      deduplicated: false,
      fileName: "screenshot.png",
      attachedToConversation: true,
    });

    render(React.createElement(WorkspaceChat, { scopeName: "MDLZ" }));

    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["fake image"], "screen.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    const previewButton = await screen.findByRole("button", { name: "Preview screen.png" });
    fireEvent.click(previewButton);

    expect(screen.getByRole("dialog", { name: "screen.png" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open original" }).getAttribute("href")).toEqual(
      expect.stringMatching(
        /^\/api\/workspace\/documents\/fcbf595a-f076-445c-9c7f-6b31730ab1ec\/download\?conversationId=[0-9a-f-]+$/,
      ),
    );
  });
});
