"use client";

import { useEffect, useRef, useState, type ReactNode, type ElementType } from "react";

type ScrollRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: ElementType;
};

/**
 * IntersectionObserver-based reveal. Adds `is-revealed` to the wrapper element
 * the first time it crosses 12% into the viewport. CSS owns the actual
 * transition (.reveal-up). Respects `prefers-reduced-motion`.
 */
export function ScrollReveal({
  children,
  className = "",
  delay = 0,
  as: Tag = "div",
}: ScrollRevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setRevealed(true);
      return;
    }

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            window.setTimeout(() => setRevealed(true), delay);
            obs.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [delay]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Component = Tag as any;
  const composed = `reveal-up${revealed ? " is-revealed" : ""}${className ? ` ${className}` : ""}`;

  return (
    <Component ref={ref} className={composed}>
      {children}
    </Component>
  );
}
