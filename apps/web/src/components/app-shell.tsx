"use client";

import {
  ArrowSquareOut,
  CreditCard,
  Files,
  Gear,
  House,
  Palette,
  Plus,
  Repeat,
} from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import type { ViewerState } from "@/lib/supabase/auth";

const mainNav: ReadonlyArray<{ href: string; label: string; icon: Icon; prefetch?: boolean }> = [
  { href: "/dashboard", label: "Dashboard", icon: House },
  { href: "/jobs/new", label: "New report", icon: Plus },
  { href: "/artifacts", label: "Reports", icon: Files },
  { href: "/recipes", label: "Recipes", icon: Repeat, prefetch: false },
  { href: "/templates", label: "Brand system", icon: Palette, prefetch: false },
];

const bottomNav: ReadonlyArray<{ href: string; label: string; icon: Icon; prefetch?: boolean }> = [
  { href: "/", label: "Website", icon: ArrowSquareOut },
  { href: "/billing", label: "Billing & Usage", icon: CreditCard, prefetch: false },
  { href: "/settings", label: "Settings", icon: Gear, prefetch: false },
];

export function AppShell({
  viewer,
  creditBalance,
  children,
}: {
  viewer: ViewerState;
  creditBalance: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const userEmail = viewer.user?.email ?? "";
  const creditMeterWidth = creditBalance === -1 ? 100 : Math.max(0, Math.min(100, (creditBalance / 25) * 100));

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Link href="/" className="brand-lockup" aria-label="Basquio website">
            <Image src="/brand/svg/logo/basquio-logo-light-bg-blue.svg" alt="Basquio" width={178} height={30} priority />
          </Link>
          <p className="sidebar-brand-note">Open the public Basquio site without leaving your workspace.</p>
        </div>

        <Link className="button sidebar-cta" href="/jobs/new">
          New report
        </Link>

        <nav className="nav stack" aria-label="Workspace">
          {mainNav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                className={isActive(item.href) ? "nav-link active" : "nav-link"}
                href={item.href}
                prefetch={item.prefetch}
              >
                <span className="nav-link-icon" aria-hidden>
                  <Icon size={18} weight={isActive(item.href) ? "fill" : "regular"} />
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

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
          {bottomNav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                className={isActive(item.href) ? "nav-link active" : "nav-link"}
                href={item.href}
                prefetch={item.prefetch}
              >
                <span className="nav-link-icon" aria-hidden>
                  <Icon size={18} weight={isActive(item.href) ? "fill" : "regular"} />
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

      <div className="workspace-shell">
        <main className="content stack-xl">{children}</main>
      </div>
    </div>
  );
}
