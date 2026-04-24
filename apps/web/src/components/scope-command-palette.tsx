"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Command, MagnifyingGlass, X } from "@phosphor-icons/react";

export type ScopeCommandAction = {
  id: string;
  label: string;
  href: string;
  group: string;
  hint?: string;
};

export function ScopeCommandPalette({
  actions,
  scopeName,
}: {
  actions: ScopeCommandAction[];
  scopeName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      previousFocusRef.current?.focus();
      return;
    }
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setActiveIndex(0);
    const focus = () => inputRef.current?.focus();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(focus);
    } else {
      focus();
    }
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return actions.slice(0, 9);
    return actions
      .filter((action) =>
        `${action.group} ${action.label} ${action.hint ?? ""}`.toLowerCase().includes(needle),
      )
      .slice(0, 9);
  }, [actions, query]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  const closePalette = () => setOpen(false);
  const activeAction = filtered[activeIndex];

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (filtered.length === 0 ? 0 : (index + 1) % filtered.length));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        filtered.length === 0 ? 0 : (index - 1 + filtered.length) % filtered.length,
      );
      return;
    }

    if (event.key === "Enter" && activeAction && document.activeElement === inputRef.current) {
      event.preventDefault();
      closePalette();
      router.push(activeAction.href);
      return;
    }

    if (event.key !== "Tab") return;

    const focusable = getFocusableElements(dialogRef.current);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="wbeta-scope-chat-command"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Open ${scopeName} command palette`}
      >
        <Command size={14} weight="bold" />
        <span>⌘K</span>
      </button>

      {open ? (
        <div className="wbeta-command-overlay" role="presentation" onMouseDown={() => setOpen(false)}>
          <div
            ref={dialogRef}
            className="wbeta-command-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Workspace command palette"
            onKeyDown={handleDialogKeyDown}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="wbeta-command-search">
              <MagnifyingGlass size={15} weight="regular" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Switch scopes, open memory, jump to deliverables"
                aria-label="Search workspace commands"
                aria-controls="scope-command-results"
                aria-activedescendant={activeAction ? `scope-command-${activeAction.id}` : undefined}
              />
              <button type="button" onClick={closePalette} aria-label="Close command palette">
                <X size={14} weight="bold" />
              </button>
            </div>
            <ul className="wbeta-command-list" id="scope-command-results">
              {filtered.map((action, index) => (
                <li key={action.id}>
                  <Link
                    href={action.href}
                    id={`scope-command-${action.id}`}
                    className={
                      index === activeIndex
                        ? "wbeta-command-item wbeta-command-item-active"
                        : "wbeta-command-item"
                    }
                    onClick={closePalette}
                    onFocus={() => setActiveIndex(index)}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span className="wbeta-command-item-group">{action.group}</span>
                    <span className="wbeta-command-item-label">{action.label}</span>
                    {action.hint ? <span className="wbeta-command-item-hint">{action.hint}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
            {filtered.length === 0 ? (
              <p className="wbeta-command-empty">No matching command.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("disabled"));
}
