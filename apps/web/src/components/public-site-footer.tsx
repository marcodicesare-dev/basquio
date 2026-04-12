import Image from "next/image";
import Link from "next/link";

export function PublicSiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div className="site-footer-brand stack">
          <Image src="/brand/svg/logo/basquio-logo-light-bg-blue.svg" alt="Basquio" width={168} height={27} />
          <p className="muted">Beautiful Intelligence.</p>
        </div>

        <div className="site-footer-column">
          <p className="site-footer-column-title">Product</p>
          <Link href="/#workflow">How it works</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/compare">Compare</Link>
          <Link href="/powerpoint-tax">The PowerPoint Tax</Link>
          <Link href="/jobs/new">Try free</Link>
        </div>

        <div className="site-footer-column">
          <p className="site-footer-column-title">Resources</p>
          <Link href="/get-started">Get started</Link>
          <Link href="/how-it-works">Full pipeline</Link>
          <Link href="/library">Output library</Link>
          <Link href="/about">About</Link>
          <a href="mailto:marco@basquio.com">Contact</a>
        </div>

        <div className="site-footer-column">
          <p className="site-footer-column-title">Legal</p>
          <Link href="/trust">Trust & Security</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/sign-in">Sign in</Link>
        </div>
      </div>

      <div className="site-footer-meta">
        <p>© 2026 Basquio</p>
      </div>
    </footer>
  );
}
