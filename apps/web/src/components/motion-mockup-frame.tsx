"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";

/**
 * Mockup wrapper with two motion behaviors (Linear / Pavlov / Vercel pattern):
 *
 * 1. Scroll-driven entrance: opacity 0 + scale 0.96 + translateY 24 ->
 *    visible. 700ms ease-out-expo.
 * 2. Mouse-tracking parallax tilt: rotateX/rotateY [+/-3deg] driven by pointer
 *    position over the frame. Smoothed via 320ms transition.
 *
 * Triggered via vanilla IntersectionObserver (motion's whileInView was
 * unreliable here because of nesting and motion v12 quirks).
 *
 * Both behaviors are no-ops when prefers-reduced-motion is on.
 */

type Props = {
  className?: string;
  children: ReactNode;
};

export function MotionMockupFrame({ className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsInView(true);
            obs.disconnect();
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mql.matches) return;
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rotX = (0.5 - py) * 3;
    const rotY = (px - 0.5) * 3;
    target.style.setProperty("--mockup-rot-x", `${rotX}deg`);
    target.style.setProperty("--mockup-rot-y", `${rotY}deg`);
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    target.style.setProperty("--mockup-rot-x", "0deg");
    target.style.setProperty("--mockup-rot-y", "0deg");
  };

  return (
    <motion.div
      ref={ref}
      className={`motion-mockup-frame ${className ?? ""}`}
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={isInView ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 24, scale: 0.96 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </motion.div>
  );
}
