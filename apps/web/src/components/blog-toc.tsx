"use client";

import { useEffect, useRef, useState } from "react";

interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

export function BlogToc({ headings }: { headings: TocItem[] }) {
  const [activeId, setActiveId] = useState<string>("");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter(Boolean) as HTMLElement[];

    if (elements.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "-100px 0% -70% 0%", threshold: [0, 0.25, 0.5] },
    );

    for (const el of elements) observerRef.current.observe(el);

    return () => observerRef.current?.disconnect();
  }, [headings]);

  if (headings.length < 2) return null;

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 100;
    window.scrollTo({ top: y, behavior: "smooth" });
    history.pushState(null, "", `#${id}`);
    setActiveId(id);
  }

  return (
    <nav className="blog-toc" aria-label="Table of contents">
      <p className="blog-toc-label">On this page</p>
      <ul className="blog-toc-list">
        {headings.map((h) => (
          <li key={h.id} className={h.level === 3 ? "blog-toc-indent" : ""}>
            <a
              href={`#${h.id}`}
              onClick={(e) => handleClick(e, h.id)}
              className={activeId === h.id ? "blog-toc-active" : ""}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
