// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

const mocks = vi.hoisted(() => ({
  textareaProps: [] as Array<Record<string, unknown>>,
  sendMessage: vi.fn(),
  stop: vi.fn(),
  regenerate: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage: mocks.sendMessage,
    status: "ready",
    stop: mocks.stop,
    regenerate: mocks.regenerate,
  }),
}));

vi.mock("react-textarea-autosize", () => ({
  default: (props: Record<string, unknown>) => {
    mocks.textareaProps.push(props);
    const value = String(props.value ?? "");
    const lineCount = Math.max(1, value.split("\n").length);
    const rows = Math.min(Number(props.maxRows ?? 10), Math.max(Number(props.minRows ?? 1), lineCount));
    return React.createElement("textarea", {
      id: props.id,
      className: props.className,
      placeholder: props.placeholder,
      value: props.value,
      disabled: props.disabled,
      "aria-label": "Message",
      style: { height: `${rows * 22}px` },
      onChange: props.onChange,
      onKeyDown: props.onKeyDown,
    });
  },
}));

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

afterEach(() => {
  cleanup();
  mocks.textareaProps.length = 0;
  mocks.sendMessage.mockClear();
  mocks.stop.mockClear();
  mocks.regenerate.mockClear();
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
});
