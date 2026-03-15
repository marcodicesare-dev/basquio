"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import type { ViewerState } from "@/lib/supabase/auth";

const navigation = [
  {
    href: "/dashboard",
    label: "Dashboard",
  },
  {
    href: "/jobs/new",
    label: "New analysis",
  },
  {
    href: "/templates",
    label: "Brand system",
  },
  {
    href: "/artifacts",
    label: "Presentations",
  },
] as const;

export function AppShell({ viewer, children }: { viewer: ViewerState; children: ReactNode }) {
  const pathname = usePathname();
  const userEmail = viewer.user?.email ?? "";

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand stack-lg">
          <Link href="/" className="brand-lockup" aria-label="Basquio home">
            <Image src="/brand/svg/logo/basquio-logo-light-bg-mono.svg" alt="Basquio" width={178} height={30} priority />
          </Link>
          <p className="muted">Beautiful Intelligence.</p>
        </div>

        <Link className="button sidebar-cta" href="/jobs/new">
          Create analysis
        </Link>

        <nav className="nav stack" aria-label="Workspace">
          {navigation.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link key={item.href} className={active ? "nav-link active" : "nav-link"} href={item.href}>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {userEmail ? (
          <div className="stack sidebar-meta">
            <p className="muted">Signed in as</p>
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
