"use client";

import { useEffect, useRef, useState } from "react";

export type RowMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

type Props = {
  items: RowMenuItem[];
  ariaLabel: string;
  disabled?: boolean;
};

/**
 * Small headless dropdown for row-level actions on the Memory
 * Inspector. The trigger is a visible 3-dot icon button so the
 * affordance is discoverable. Hover-only menus do not scan well on
 * touch devices and miss first-time users; per Brief 7 B10.
 */
export function WorkspaceRowMenu({ items, ariaLabel, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="wbeta-row-menu" ref={containerRef}>
      <button
        type="button"
        className="wbeta-row-menu-trigger"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden>⋯</span>
      </button>
      {open ? (
        <ul className="wbeta-row-menu-list" role="menu">
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className={`wbeta-row-menu-item${item.danger ? " wbeta-row-menu-item-danger" : ""}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
