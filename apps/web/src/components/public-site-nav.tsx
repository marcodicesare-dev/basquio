"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { publicNavLinks } from "@/app/site-content";

export function PublicSiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <section className={`landing-nav-panel public-nav${open ? " public-nav-open" : ""}`}>
      <div className="row landing-nav-copy landing-nav-brand-row">
        <Link href="/" className="brand-lockup" aria-label="Basquio home">
          <Image
            src="/brand/svg/logo/basquio-logo-light-bg-mono.svg"
            alt="Basquio"
            width={188}
            height={30}
            priority
          />
        </Link>
        <button
          type="button"
          className="public-nav-toggle"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="public-nav-toggle-bar" />
          <span className="public-nav-toggle-bar" />
          <span className="public-nav-toggle-bar" />
        </button>
      </div>

      <nav className="public-nav-links" aria-label="Public">
        {publicNavLinks.map((link) => (
          <Link key={link.href} className="public-nav-link" href={link.href} onClick={() => setOpen(false)}>
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="row landing-nav-copy landing-nav-actions">
        <Link className="button secondary" href="/sign-in?next=%2Fdashboard">
          Sign in
        </Link>
        <Link className="button" href="/jobs/new">
          Try it with your data
        </Link>
      </div>
    </section>
  );
}
