import Image from "next/image";
import Link from "next/link";

import { publicNavLinks } from "@/app/site-content";

export function PublicSiteNav() {
  return (
    <section className="landing-nav-panel public-nav">
      <div className="row landing-nav-copy">
        <Link href="/" className="brand-lockup" aria-label="Basquio home">
          <Image
            src="/brand/svg/logo/basquio-logo-light-bg-mono.svg"
            alt="Basquio"
            width={188}
            height={30}
            priority
          />
        </Link>
        <span className="nav-pill">Beautiful Intelligence.</span>
      </div>

      <nav className="public-nav-links" aria-label="Public">
        {publicNavLinks.map((link) => (
          <Link key={link.href} className="public-nav-link" href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="row landing-nav-copy">
        <Link className="button secondary" href="/#output">
          See examples
        </Link>
        <Link className="button secondary" href="/sign-in?next=%2Fdashboard">
          Sign in
        </Link>
        <Link className="button" href="/jobs/new">
          Try with your data
        </Link>
      </div>
    </section>
  );
}
