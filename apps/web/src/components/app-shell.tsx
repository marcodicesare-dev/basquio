"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import type { ViewerState } from "@/lib/supabase/auth";

const mainNav = [
  { href: "/dashboard", label: "Home" },
  { href: "/jobs/new", label: "New report" },
  { href: "/artifacts", label: "Reports" },
  { href: "/recipes", label: "Recipes" },
  { href: "/templates", label: "Brand system" },
] as const;

const bottomNav = [
  { href: "/billing", label: "Billing & Usage" },
  { href: "/settings", label: "Settings" },
] as const;

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

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Link href="/" className="brand-lockup" aria-label="Basquio home">
            <Image src="/brand/svg/logo/basquio-logo-light-bg-mono.svg" alt="Basquio" width={178} height={30} priority />
          </Link>
        </div>

        <Link className="button sidebar-cta" href="/jobs/new">
          New report
        </Link>

        <nav className="nav stack" aria-label="Workspace">
          {mainNav.map((item) => (
            <Link key={item.href} className={isActive(item.href) ? "nav-link active" : "nav-link"} href={item.href}>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-credits-block">
          <div className="sidebar-credits-row">
            <span className="sidebar-credits-number">{creditBalance}</span>
            <span className="sidebar-credits-label">credits</span>
          </div>
          <Link className="button secondary sidebar-buy-link" href="/billing">
            Buy credits
          </Link>
        </div>

        <nav className="nav stack sidebar-bottom-nav" aria-label="Account">
          {bottomNav.map((item) => (
            <Link key={item.href} className={isActive(item.href) ? "nav-link active" : "nav-link"} href={item.href}>
              <span>{item.label}</span>
            </Link>
          ))}
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
