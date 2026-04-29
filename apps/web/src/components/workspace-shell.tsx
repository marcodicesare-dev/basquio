"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowsLeftRight,
  CaretDown,
  CaretUp,
  Check,
  Gear,
  HouseLine,
  List,
  SignOut,
  X,
} from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import {
  WorkspaceCommandPalette,
  type WorkspaceCommandAction,
} from "@/components/workspace-command-palette";
import { WorkspaceInteractionLayer } from "@/components/workspace-interaction-layer";
import { WorkspaceSidebar, type SidebarRecentConversation } from "@/components/workspace-sidebar";
import { getWorkspaceCopy, type WorkspaceLocale } from "@/i18n";
import type { ViewerState } from "@/lib/supabase/auth";
import type { ScopeCounts, ScopeTree } from "@/lib/workspace/scopes";

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  kind: "team_beta" | "demo_template" | "customer";
};

export function WorkspaceShell({
  viewer,
  scopeTree,
  scopeCounts,
  recentConversations,
  commandActions = [],
  locale = "en",
  currentWorkspace,
  availableWorkspaces = [],
  children,
}: {
  viewer: ViewerState;
  scopeTree: ScopeTree;
  scopeCounts: Record<string, ScopeCounts>;
  recentConversations?: SidebarRecentConversation[];
  commandActions?: WorkspaceCommandAction[];
  locale?: WorkspaceLocale;
  currentWorkspace?: WorkspaceSummary;
  availableWorkspaces?: WorkspaceSummary[];
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

        {commandActions.length > 0 ? (
          <div className="wbeta-side-search">
            <WorkspaceCommandPalette actions={commandActions} />
          </div>
        ) : null}

        <WorkspaceSidebar
          tree={scopeTree}
          counts={scopeCounts}
          recentConversations={recentConversations ?? []}
          copy={copy.sidebar}
          onNavigate={() => setMobileOpen(false)}
        />

        <UserMenu
          email={userEmail}
          initial={userInitial}
          copy={copy.shell}
          currentWorkspace={currentWorkspace}
          availableWorkspaces={availableWorkspaces}
        />
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
  currentWorkspace,
  availableWorkspaces,
}: {
  email: string;
  initial: string;
  copy: ReturnType<typeof getWorkspaceCopy>["shell"];
  currentWorkspace?: WorkspaceSummary;
  availableWorkspaces?: WorkspaceSummary[];
}) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const router = useRouter();
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

  async function handleSwitch(workspaceId: string) {
    if (switching) return;
    setSwitching(workspaceId);
    try {
      const response = await fetch("/api/workspace/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      if (!response.ok) {
        throw new Error(`Switch failed (${response.status})`);
      }
      setOpen(false);
      router.refresh();
    } catch (error) {
      console.error("workspace switch failed", error);
    } finally {
      setSwitching(null);
    }
  }

  const showSwitcher =
    !!currentWorkspace && (availableWorkspaces?.length ?? 0) > 1;

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
          {currentWorkspace ? (
            <div className="wbeta-user-workspace-current" aria-label="Active workspace">
              <span className="wbeta-user-workspace-label">Workspace</span>
              <span className="wbeta-user-workspace-name">{currentWorkspace.name}</span>
            </div>
          ) : null}
          {showSwitcher ? (
            <>
              <div className="wbeta-user-section-label">
                <ArrowsLeftRight size={12} weight="regular" />
                <span>Switch workspace</span>
              </div>
              {availableWorkspaces!.map((workspace) => {
                const active = workspace.id === currentWorkspace?.id;
                return (
                  <button
                    key={workspace.id}
                    type="button"
                    role="menuitem"
                    className={
                      active
                        ? "wbeta-user-item wbeta-user-item-active"
                        : "wbeta-user-item"
                    }
                    onClick={() => {
                      if (!active) handleSwitch(workspace.id);
                    }}
                    disabled={switching !== null}
                  >
                    <span className="wbeta-user-workspace-row-name">{workspace.name}</span>
                    {active ? (
                      <Check size={12} weight="bold" />
                    ) : switching === workspace.id ? (
                      <span className="wbeta-user-workspace-row-spinner" aria-hidden />
                    ) : null}
                  </button>
                );
              })}
              <div className="wbeta-user-sep" aria-hidden />
            </>
          ) : null}
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
