"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import type { ViewerState } from "@/lib/supabase/auth";

const navigation = [
  {
    href: "/dashboard",
    label: "Dashboard",
    detail: "See recent analyses and outputs.",
  },
  {
    href: "/jobs/new",
    label: "Create analysis",
    detail: "Upload data and generate a presentation.",
  },
  {
    href: "/templates",
    label: "Templates",
    detail: "Manage templates and brand inputs.",
  },
  {
    href: "/artifacts",
    label: "Recent outputs",
    detail: "Review generated presentations.",
  },
] as const;

export function AppShell({ viewer, children }: { viewer: ViewerState; children: ReactNode }) {
  const pathname = usePathname();
  const authLabel = viewer.user?.email ?? "Preview mode";
  const currentSection =
    navigation.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) ?? navigation[0];

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
                <span className="nav-link-copy">{item.detail}</span>
              </Link>
            );
          })}
        </nav>

        <div className="stack sidebar-meta">
          <p className="muted">{authLabel}</p>
        </div>
      </aside>

      <div className="workspace-shell">
        <header className="workspace-topbar">
          <div className="stack">
            <p className="workspace-title">{currentSection.label}</p>
            <p className="muted">{currentSection.detail}</p>
          </div>
        </header>

        <main className="content stack-xl">{children}</main>
      </div>
    </div>
  );
}
