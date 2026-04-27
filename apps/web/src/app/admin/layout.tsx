import Link from "next/link";

import { getAdminViewerState } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin · Basquio",
  robots: { index: false, follow: false },
};

const NAV: Array<{ href: string; label: string }> = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/runs", label: "Runs" },
  { href: "/admin/audit", label: "Audit" },
  { href: "/admin/candidates", label: "Candidates" },
  { href: "/admin/hints", label: "Hints" },
  { href: "/admin/drift", label: "Drift" },
  { href: "/admin/cost", label: "Cost" },
  { href: "/admin/prompts", label: "Prompts" },
  { href: "/admin/skills", label: "Skills" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const state = await getAdminViewerState();
  if (state.kind === "unauthenticated") {
    return (
      <main className="wbeta-admin-shell wbeta-admin-shell-deny">
        <h1>Sign in required</h1>
        <p>The admin console requires a Basquio super-admin sign-in.</p>
        <p>
          <Link href="/sign-in?next=/admin">Sign in</Link>
        </p>
      </main>
    );
  }
  if (state.kind === "forbidden") {
    return (
      <main className="wbeta-admin-shell wbeta-admin-shell-deny">
        <h1>Forbidden</h1>
        <p>Your account is signed in but does not have super-admin access.</p>
      </main>
    );
  }

  return (
    <div className="wbeta-admin-shell">
      <aside className="wbeta-admin-side">
        <header>
          <p className="wbeta-admin-eyebrow">Basquio</p>
          <h1>Admin</h1>
          <p className="wbeta-admin-user">{state.email ?? "(no email)"}</p>
        </header>
        <nav>
          <ul>
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main className="wbeta-admin-main">{children}</main>
    </div>
  );
}
