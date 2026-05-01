"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { publicNavLinks } from "@/app/site-content";

export function PublicSiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <nav className={`public-nav-shell${open ? " public-nav-shell-open" : ""}`} aria-label="Public navigation">
      <div className="public-nav-shell-inner">
        <Link href="/" className="public-nav-brand" aria-label="Basquio home">
          <Image
            src="/brand/svg/logo/basquio-logo-light-bg-blue.svg"
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
          aria-controls="public-nav-links"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="public-nav-toggle-bar" />
          <span className="public-nav-toggle-bar" />
          <span className="public-nav-toggle-bar" />
        </button>

        <ul className="public-nav-list" id="public-nav-links">
          {publicNavLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="public-nav-link"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="public-nav-auth">
          <Link
            href="/sign-in?next=%2Fdashboard"
            className="public-nav-signin-link"
            onClick={() => setOpen(false)}
          >
            Sign in
          </Link>
          <Link
            href="/jobs/new"
            className="public-nav-cta"
            onClick={() => setOpen(false)}
          >
            Try with your data
          </Link>
        </div>
      </div>
    </nav>
  );
}
