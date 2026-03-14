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
    detail: "See recent analyses, outputs, and workspace activity.",
  },
  {
    href: "/jobs/new",
    label: "Create analysis",
    detail: "Upload your data, set the brief, and generate the presentation.",
  },
  {
    href: "/templates",
    label: "Templates",
    detail: "Manage templates and brand inputs.",
  },
  {
    href: "/artifacts",
    label: "Recent outputs",
    detail: "Review generated PowerPoint and PDF outputs.",
  },
] as const;

export function AppShell({ viewer, children }: { viewer: ViewerState; children: ReactNode }) {
  const pathname = usePathname();
  const authLabel = viewer.user?.email ?? (viewer.configured ? "Local preview mode" : "Supabase not configured");
  const currentSection =
    navigation.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) ?? navigation[0];

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand stack-lg">
          <Link href="/" className="brand-lockup" aria-label="Basquio home">
            <Image src="/brand/svg/logo/basquio-logo-light-bg-mono.svg" alt="Basquio" width={178} height={30} priority />
          </Link>
          <div className="stack">
            <p className="section-label">Beautiful Intelligence.</p>
            <h2>Analyze your data. Deliver the presentation.</h2>
            <p className="muted">
              Upload business data, add context and an optional template, and get an editable PowerPoint plus polished
              PDF.
            </p>
          </div>
          <div className="sidebar-chip-row">
            <span className="sidebar-chip">Data in</span>
            <span className="sidebar-chip">Insights out</span>
            <span className="sidebar-chip">PPTX + PDF</span>
          </div>
        </div>

        <Link className="button sidebar-cta" href="/jobs/new">
          Try it with your data
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

        <div className="stack sidebar-callout dark-callout">
          <p className="section-label light">How it works</p>
          <p>Upload data and context. Basquio finds the insights, builds the story, and delivers the presentation.</p>
          <div className="sidebar-note-list">
            <p>Your brief shapes the narrative.</p>
            <p>Both outputs stay in sync.</p>
          </div>
        </div>

        <div className="stack sidebar-meta">
          <p className="section-label">Operator</p>
          <p>{viewer.configured ? "Authenticated workspace ready" : "Local preview workspace"}</p>
          <p className="muted">{authLabel}</p>
        </div>
      </aside>

      <div className="workspace-shell">
        <header className="workspace-topbar">
          <div className="stack">
            <p className="eyebrow">Basquio</p>
            <div className="stack">
              <p className="workspace-title">{currentSection.label}</p>
              <p className="muted">{currentSection.detail}</p>
            </div>
          </div>

          <div className="workspace-status">
            <span className="workspace-pill">{viewer.configured ? "Auth configured" : "Preview mode"}</span>
            <span className="workspace-operator">{authLabel}</span>
          </div>
        </header>

        <main className="content stack-xl">{children}</main>
      </div>
    </div>
  );
}
