"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDown, CaretUp, Gear, HouseLine, List, SignOut, X } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import { WorkspaceInteractionLayer } from "@/components/workspace-interaction-layer";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { getWorkspaceCopy, type WorkspaceLocale } from "@/i18n";
import type { ViewerState } from "@/lib/supabase/auth";
import type { ScopeCounts, ScopeTree } from "@/lib/workspace/scopes";

export function WorkspaceShell({
  viewer,
  scopeTree,
  scopeCounts,
  recentConversations,
  locale = "en",
  children,
}: {
  viewer: ViewerState;
  scopeTree: ScopeTree;
  scopeCounts: Record<string, ScopeCounts>;
  recentConversations?: Array<{ id: string; title: string; lastMessageAt: string }>;
  locale?: WorkspaceLocale;
  children: ReactNode;
}) {
  const userEmail = viewer.user?.email ?? "";
  const userInitial = userEmail.slice(0, 1).toUpperCase() || "?";
  const copy = getWorkspaceCopy(locale);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="wbeta-shell">
      <WorkspaceInteractionLayer />
      <aside
        className={mobileOpen ? "wbeta-side wbeta-side-mobile-open" : "wbeta-side"}
        aria-label={copy.shell.workspaceLabel}
      >
        <header className="wbeta-side-brand">
          <Link
            href="/workspace"
            className="wbeta-side-logo"
            aria-label={copy.shell.homeAria}
            onClick={() => setMobileOpen(false)}
          >
            <Image
              src="/brand/svg/logo/basquio-logo-light-bg-blue.svg"
              alt="Basquio"
              width={108}
              height={18}
              priority
            />
          </Link>
          <div className="wbeta-side-brand-actions">
            <span className="wbeta-side-chip" aria-label={copy.shell.beta}>{copy.shell.beta}</span>
            <button
              type="button"
              className="wbeta-mobile-nav-toggle"
              onClick={() => setMobileOpen((open) => !open)}
              aria-expanded={mobileOpen}
              aria-controls="wbeta-workspace-nav"
              aria-label={mobileOpen ? copy.shell.closeMenu : copy.shell.menu}
            >
              {mobileOpen ? <X size={16} weight="bold" /> : <List size={16} weight="bold" />}
            </button>
          </div>
        </header>

        <WorkspaceSidebar
          tree={scopeTree}
          counts={scopeCounts}
          recentConversations={recentConversations ?? []}
          copy={copy.sidebar}
          onNavigate={() => setMobileOpen(false)}
        />

        <UserMenu email={userEmail} initial={userInitial} copy={copy.shell} />
      </aside>

      {/* Routes opt into specialized workspace layouts inside their page component.
        Scope routes now use the chat-first shell with a context rail. Shell stays
        two-column so non-scope pages keep full width. */}
      <main className="wbeta-main">{children}</main>
    </div>
  );
}

function UserMenu({
  email,
  initial,
  copy,
}: {
  email: string;
  initial: string;
  copy: ReturnType<typeof getWorkspaceCopy>["shell"];
}) {
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
            <span>{copy.appHome}</span>
          </Link>
          <Link href="/settings" className="wbeta-user-item" role="menuitem" prefetch={false}>
            <Gear size={14} weight="regular" />
            <span>{copy.settings}</span>
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
