"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDown, CaretUp, Gear, HouseLine, SignOut } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import type { ViewerState } from "@/lib/supabase/auth";
import type { ScopeCounts, ScopeTree } from "@/lib/workspace/scopes";

export function WorkspaceShell({
  viewer,
  scopeTree,
  scopeCounts,
  children,
}: {
  viewer: ViewerState;
  scopeTree: ScopeTree;
  scopeCounts: Record<string, ScopeCounts>;
  children: ReactNode;
}) {
  const userEmail = viewer.user?.email ?? "";
  const userInitial = userEmail.slice(0, 1).toUpperCase() || "?";

  return (
    <div className="wbeta-shell">
      <aside className="wbeta-side" aria-label="Workspace">
        <header className="wbeta-side-brand">
          <Link href="/workspace" className="wbeta-side-logo" aria-label="Basquio workspace home">
            <Image
              src="/brand/svg/logo/basquio-logo-light-bg-blue.svg"
              alt="Basquio"
              width={108}
              height={18}
              priority
            />
          </Link>
          <span className="wbeta-side-chip" aria-label="Beta">beta</span>
        </header>

        <WorkspaceSidebar tree={scopeTree} counts={scopeCounts} />

        <UserMenu email={userEmail} initial={userInitial} />
      </aside>

      {/* Routes opt into the three-tier scope layout (main + memory aside)
        via the wbeta-scope-three-col wrapper inside their page component.
        Shell stays two-column so non-scope pages keep full width. See
        docs/specs/2026-04-22-workspace-shell-ux-spec.md §4.4. */}
      <main className="wbeta-main">{children}</main>
    </div>
  );
}

function UserMenu({ email, initial }: { email: string; initial: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!email) return null;

  return (
    <div className="wbeta-user" ref={rootRef}>
      <button
        type="button"
        className="wbeta-user-pill"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="wbeta-user-avatar" aria-hidden>{initial}</span>
        <span className="wbeta-user-email">{email}</span>
        <span className="wbeta-user-caret" aria-hidden>
          {open ? <CaretDown size={12} weight="bold" /> : <CaretUp size={12} weight="bold" />}
        </span>
      </button>
      {open ? (
        <div className="wbeta-user-menu" role="menu">
          <Link href="/dashboard" className="wbeta-user-item" role="menuitem" prefetch={false}>
            <HouseLine size={14} weight="regular" />
            <span>App home</span>
          </Link>
          <Link href="/settings" className="wbeta-user-item" role="menuitem" prefetch={false}>
            <Gear size={14} weight="regular" />
            <span>Settings</span>
          </Link>
          <div className="wbeta-user-sep" aria-hidden />
          <div className="wbeta-user-signout" role="menuitem">
            <SignOut size={14} weight="regular" />
            <SignOutButton />
          </div>
        </div>
      ) : null}
    </div>
  );
}
