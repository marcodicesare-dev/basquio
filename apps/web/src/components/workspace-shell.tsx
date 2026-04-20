"use client";

import {
  ArrowSquareOut,
  CreditCard,
  Gear,
  House as HouseBase,
} from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import type { ViewerState } from "@/lib/supabase/auth";
import type { ScopeCounts, ScopeTree } from "@/lib/workspace/scopes";

const accountNav = [
  { href: "/dashboard", label: "App home", icon: HouseBase, prefetch: false },
  { href: "/", label: "Website", icon: ArrowSquareOut, prefetch: false },
  { href: "/billing", label: "Billing & Usage", icon: CreditCard, prefetch: false },
  { href: "/settings", label: "Settings", icon: Gear, prefetch: false },
] as const;

export function WorkspaceShell({
  viewer,
  scopeTree,
  scopeCounts,
  creditBalance,
  children,
}: {
  viewer: ViewerState;
  scopeTree: ScopeTree;
  scopeCounts: Record<string, ScopeCounts>;
  creditBalance: number;
  children: ReactNode;
}) {
  const userEmail = viewer.user?.email ?? "";
  const creditMeterWidth =
    creditBalance === -1 ? 100 : Math.max(0, Math.min(100, (creditBalance / 25) * 100));

  return (
    <div className="app-frame app-frame-workspace">
      <aside className="sidebar sidebar-workspace">
        <div className="sidebar-brand">
          <Link href="/workspace" className="brand-lockup" aria-label="Basquio workspace home">
            <Image
              src="/brand/svg/logo/basquio-logo-light-bg-blue.svg"
              alt="Basquio"
              width={178}
              height={30}
              priority
            />
          </Link>
          <p className="sidebar-brand-note">
            Your analyst memory. Every question pulls from your clients, stakeholders, and style.
          </p>
          <span className="sidebar-brand-pill" aria-label="Workspace beta">
            Beta
          </span>
        </div>

        <Link className="button sidebar-cta" href="/jobs/new">
          New report
        </Link>

        <WorkspaceSidebar tree={scopeTree} counts={scopeCounts} />

        <div className="sidebar-credits-block">
          <div className="sidebar-credits-head">
            <span className="sidebar-credits-kicker">Usage</span>
            <span className="sidebar-credits-caption">
              {creditBalance === -1 ? "Team access" : "Visible after each run"}
            </span>
          </div>

          {creditBalance === -1 ? (
            <>
              <div className="sidebar-credits-row">
                <span className="sidebar-credits-number">Unlimited</span>
              </div>
              <div className="sidebar-credit-meter">
                <span className="sidebar-credit-meter-fill" style={{ width: "100%" }} />
              </div>
            </>
          ) : (
            <>
              <div className="sidebar-credits-row">
                <span className="sidebar-credits-number">{creditBalance}</span>
                <span className="sidebar-credits-label">credits left</span>
              </div>
              <div className="sidebar-credit-meter">
                <span className="sidebar-credit-meter-fill" style={{ width: `${creditMeterWidth}%` }} />
              </div>
              <Link className="button small secondary sidebar-buy-link" href="/billing">
                Manage usage
              </Link>
            </>
          )}
        </div>

        <nav className="nav stack sidebar-bottom-nav" aria-label="Account">
          {accountNav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                className="nav-link"
                href={item.href}
                prefetch={item.prefetch}
              >
                <span className="nav-link-icon" aria-hidden>
                  <Icon size={18} weight="regular" />
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {userEmail ? (
          <div className="stack sidebar-meta">
            <p className="sidebar-user-email">{userEmail}</p>
            <SignOutButton />
          </div>
        ) : null}
      </aside>

      <div className="workspace-shell workspace-shell-beta">
        <main className="wbeta-main">{children}</main>
      </div>
    </div>
  );
}
