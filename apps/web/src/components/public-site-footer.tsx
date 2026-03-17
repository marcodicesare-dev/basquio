import Image from "next/image";
import Link from "next/link";

import { publicNavLinks } from "@/app/site-content";

export function PublicSiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-brand stack">
        <Image src="/brand/svg/logo/basquio-logo-light-bg-mono.svg" alt="Basquio" width={168} height={27} />
        <p className="muted">Executive-grade reporting from structured data.</p>
        <p className="muted">
          Contact:{" "}
          <a href="mailto:marco@basquio.com">
            marco@basquio.com
          </a>
        </p>
      </div>

      <div className="site-footer-links">
        {publicNavLinks.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
        <Link href="/get-started">Get started</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/sign-in">Sign in</Link>
      </div>

      <div className="site-footer-meta">
        <p>Built by Marco Di Cesare in Zurich.</p>
        <p>© 2026 Basquio</p>
      </div>
    </footer>
  );
}
