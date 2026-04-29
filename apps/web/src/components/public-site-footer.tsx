import Image from "next/image";
import Link from "next/link";

export function PublicSiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div className="site-footer-brand stack">
          <Image src="/brand/svg/logo/basquio-logo-light-bg-blue.svg" alt="Basquio" width={168} height={27} />
          <p className="muted">Research context in. Finished files out.</p>
        </div>

        <div className="site-footer-column">
          <p className="site-footer-column-title">Product</p>
          <Link href="/workspace-product">Workspace</Link>
          <Link href="/pay-as-you-go">Pay as you go</Link>
          <Link href="/workspace-pro">Workspace Pro</Link>
          <Link href="/team-workspace">Team Workspace</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/compare">Compare</Link>
        </div>

        <div className="site-footer-column">
          <p className="site-footer-column-title">Resources</p>
          <Link href="/get-started">Get started</Link>
          <Link href="/security">Security</Link>
          <Link href="/library">Output library</Link>
          <Link href="/powerpoint-tax">PowerPoint Tax</Link>
          <Link href="/blog">Blog</Link>
          <Link href="/about">About</Link>
          <a href="mailto:marco@basquio.com">Contact</a>
        </div>

        <div className="site-footer-column">
          <p className="site-footer-column-title">Legal</p>
          <Link href="/security">Security</Link>
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
