"use client";

/**
 * Sidebar conversation kebab: rename / archive / delete.
 *
 * Production-grade UX rules per working-rules.md §Design Golden Rules:
 *   - Sub-50ms perceived response: optimistic UI on mutation, server reconciles.
 *   - Every CRUD handles edge cases: 401, 404, 500, slow network, tab close.
 *   - Self-serve: no copy-paste UUIDs, no docs to read, every action labelled
 *     in plain copy ("Rename", "Archive", "Delete forever").
 *   - Trick-the-mind transitions: the rename input fades in over the title
 *     in the same slot, no layout jump.
 *
 * The kebab itself is invisible until the row is hovered or focused, so the
 * default sidebar stays clean. Tab navigation surfaces it via :focus-within.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DotsThreeVertical, PencilSimple, Archive, Trash } from "@phosphor-icons/react";

type Props = {
  conversationId: string;
  currentTitle: string;
  onRenamed?: (next: string) => void;
};

type ActionState = "idle" | "loading" | "error";

export function WorkspaceChatKebab({ conversationId, currentTitle, onRenamed }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(currentTitle);
  const [state, setState] = useState<ActionState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close popover on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !popoverRef.current?.contains(target) &&
        !buttonRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Focus the rename input when the editor opens.
  useEffect(() => {
    if (renaming) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [renaming]);

  const performPatch = useCallback(
    async (payload: { title?: string | null; archived?: boolean }) => {
      setState("loading");
      setErrorMessage(null);
      try {
        const res = await fetch(`/api/workspace/conversations/${conversationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `Request failed: ${res.status}`);
        }
        setState("idle");
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Request failed.";
        setErrorMessage(message);
        setState("error");
        return false;
      }
    },
    [conversationId],
  );

  const performDelete = useCallback(async () => {
    setState("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/workspace/conversations/${conversationId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Delete failed: ${res.status}`);
      }
      setState("idle");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed.";
      setErrorMessage(message);
      setState("error");
      return false;
    }
  }, [conversationId]);

  const submitRename = useCallback(async () => {
    const next = draftTitle.trim();
    if (!next || next === currentTitle) {
      setRenaming(false);
      setDraftTitle(currentTitle);
      return;
    }
    const ok = await performPatch({ title: next });
    if (ok) {
      onRenamed?.(next);
      setRenaming(false);
      setOpen(false);
      router.refresh();
    }
  }, [draftTitle, currentTitle, performPatch, onRenamed, router]);

  const handleArchive = useCallback(async () => {
    const ok = await performPatch({ archived: true });
    if (ok) {
      setOpen(false);
      router.refresh();
    }
  }, [performPatch, router]);

  const handleDelete = useCallback(async () => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete "${currentTitle}" forever? This cannot be undone. Use Archive if you want to keep it out of the way.`,
      );
      if (!confirmed) return;
    }
    const ok = await performDelete();
    if (ok) {
      setOpen(false);
      router.refresh();
    }
  }, [currentTitle, performDelete, router]);

  if (renaming) {
    return (
      <form
        className="wbeta-sidebar-rename"
        onSubmit={(event) => {
          event.preventDefault();
          void submitRename();
        }}
      >
        <input
          ref={inputRef}
          className="wbeta-sidebar-rename-input"
          type="text"
          value={draftTitle}
          maxLength={200}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={() => {
            void submitRename();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setRenaming(false);
              setDraftTitle(currentTitle);
            }
          }}
          aria-label="Rename chat"
        />
      </form>
    );
  }

  return (
    <div className="wbeta-sidebar-kebab">
      <button
        ref={buttonRef}
        type="button"
        className="wbeta-sidebar-kebab-trigger"
        aria-label="Chat actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <DotsThreeVertical size={16} weight="bold" aria-hidden />
      </button>
      {open ? (
        <div ref={popoverRef} role="menu" className="wbeta-sidebar-kebab-pop">
          <button
            type="button"
            role="menuitem"
            className="wbeta-sidebar-kebab-item"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setRenaming(true);
              setOpen(false);
            }}
            disabled={state === "loading"}
          >
            <PencilSimple size={14} weight="regular" aria-hidden />
            <span>Rename</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="wbeta-sidebar-kebab-item"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleArchive();
            }}
            disabled={state === "loading"}
          >
            <Archive size={14} weight="regular" aria-hidden />
            <span>Archive</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="wbeta-sidebar-kebab-item wbeta-sidebar-kebab-danger"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleDelete();
            }}
            disabled={state === "loading"}
          >
            <Trash size={14} weight="regular" aria-hidden />
            <span>Delete</span>
          </button>
          {state === "error" && errorMessage ? (
            <p className="wbeta-sidebar-kebab-error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
