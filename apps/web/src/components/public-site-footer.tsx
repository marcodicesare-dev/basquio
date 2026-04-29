import Image from "next/image";
import Link from "next/link";

export function PublicSiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div className="site-footer-brand stack">
          <Image src="/brand/svg/logo/basquio-logo-light-bg-blue.svg" alt="Basquio" width={168} height={27} />
          <p className="muted">For market research teams.</p>
        </div>

        <div className="site-footer-column">
          <p className="site-footer-column-title">Product</p>
          <Link href="/#workspace">Workspace</Link>
          <Link href="/#paths">Pay as you go</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/compare">Compare</Link>
          <Link href="/jobs/new">Start one output</Link>
        </div>

        <div className="site-footer-column">
          <p className="site-footer-column-title">Resources</p>
          <Link href="/library">Output library</Link>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/blog">Blog</Link>
          <Link href="/powerpoint-tax">PowerPoint Tax</Link>
          <Link href="/about">About</Link>
        </div>

        <div className="site-footer-column">
          <p className="site-footer-column-title">Trust</p>
          <Link href="/security">Security</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="mailto:marco@basquio.com">Contact</a>
          <Link href="/sign-in">Sign in</Link>
        </div>
      </div>

      <div className="site-footer-meta">
        <p>© 2026 Basquio</p>
      </div>
    </footer>
  );
}
