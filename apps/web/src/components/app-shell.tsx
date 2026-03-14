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
    detail: "Pipeline status, latest report signals, and recent output activity.",
  },
  {
    href: "/jobs/new",
    label: "New run",
    detail: "Upload the evidence package, set the brief, and generate the deck pair.",
  },
  {
    href: "/templates",
    label: "Templates",
    detail: "Review the template contract, brand tokens, and layout baseline.",
  },
  {
    href: "/artifacts",
    label: "Artifacts",
    detail: "Inspect generated deliverables and keep PPTX and PDF outputs paired.",
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
            <p className="section-label">Evidence-backed reporting</p>
            <h2>Intelligence first. Artifacts second.</h2>
            <p className="muted">
              Basquio turns a structured evidence package, a report brief, and brand direction into one canonical slide
              contract for both PPTX and PDF.
            </p>
          </div>
          <div className="sidebar-chip-row">
            <span className="sidebar-chip">Package aware</span>
            <span className="sidebar-chip">PPTX + PDF</span>
            <span className="sidebar-chip">Deterministic first</span>
          </div>
        </div>

        <Link className="button sidebar-cta" href="/jobs/new">
          Start new run
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
          <p className="section-label light">System posture</p>
          <p>Parse the package, rank evidence, plan the story, then render the deck pair.</p>
          <div className="sidebar-note-list">
            <p>Report brief stays part of the product input, not prompt garnish.</p>
            <p>Template and brand interpretation remain contract-bound through `TemplateProfile`.</p>
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
            <p className="eyebrow">Basquio workspace</p>
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
