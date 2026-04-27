import Image from "next/image";
import Link from "next/link";
import {
  ChartBar,
  ChatText,
  ClipboardText,
  CurrencyDollar,
  House,
  Lightbulb,
  Stack,
  TextT,
  WarningCircle,
  Wrench,
} from "@phosphor-icons/react/dist/ssr";

import { getAdminViewerState } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin · Basquio",
  robots: { index: false, follow: false },
};

const NAV: Array<{ href: string; label: string; icon: typeof House }> = [
  { href: "/admin", label: "Overview", icon: ChartBar },
  { href: "/admin/runs", label: "Runs", icon: ChatText },
  { href: "/admin/audit", label: "Audit", icon: ClipboardText },
  { href: "/admin/candidates", label: "Candidates", icon: Stack },
  { href: "/admin/hints", label: "Hints", icon: Lightbulb },
  { href: "/admin/drift", label: "Drift", icon: WarningCircle },
  { href: "/admin/cost", label: "Cost", icon: CurrencyDollar },
  { href: "/admin/prompts", label: "Prompts", icon: TextT },
  { href: "/admin/skills", label: "Skills", icon: Wrench },
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
        <header className="wbeta-admin-side-head">
          <Link href="/" className="wbeta-admin-logo" aria-label="Basquio">
            <Image
              src="/brand/png/icon/2x/basquio-icon-ultramarine@2x.png"
              alt=""
              width={28}
              height={28}
              priority
            />
            <span>Basquio</span>
          </Link>
          <p className="wbeta-admin-eyebrow">Admin console</p>
        </header>
        <nav className="wbeta-admin-nav" aria-label="Admin sections">
          <ul>
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link href={item.href}>
                    <Icon size={16} weight="regular" aria-hidden />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <footer className="wbeta-admin-side-foot">
          <span className="wbeta-admin-user-pill" title={state.email ?? "Super admin"}>
            {state.email ?? "(no email)"}
          </span>
        </footer>
      </aside>
      <main className="wbeta-admin-main">{children}</main>
    </div>
  );
}
