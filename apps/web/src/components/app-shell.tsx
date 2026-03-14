import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import type { ViewerState } from "@/lib/supabase/auth";

const navigation = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/jobs/new", label: "New generation" },
  { href: "/templates", label: "Templates" },
  { href: "/artifacts", label: "Artifacts" },
];

export function AppShell({ viewer, children }: { viewer: ViewerState; children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="stack">
          <Image
            src="/brand/svg/logo/basquio-logo-light-bg-blue.svg"
            alt="Basquio"
            width={170}
            height={28}
            priority
          />
          <p className="eyebrow">Basquio</p>
          <h2>Internal scaffold</h2>
          <p className="muted">Intelligence first. Renderers hang off the slide plan.</p>
        </div>

        <nav className="stack nav">
          {navigation.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="panel stack compact">
          <p className="eyebrow">Auth</p>
          <p>{viewer.configured ? (viewer.user?.email ?? "No active session") : "Supabase env missing"}</p>
        </div>
      </aside>

      <main className="content">{children}</main>
    </div>
  );
}
