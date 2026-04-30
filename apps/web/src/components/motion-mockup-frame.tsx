"use client";

import { type ReactNode } from "react";
import { motion } from "motion/react";

/**
 * Wraps a mockup with two motion behaviors used by Linear, Pavlov and Vercel
 * marketing surfaces:
 *
 * 1. Subtle scroll-driven entrance: scale 0.96 -> 1.0 + translateY 24 -> 0 +
 *    fade 0 -> 1 when the wrapper enters viewport. 700ms ease-out-expo.
 * 2. Mouse-tracking parallax tilt: rotateX/rotateY [0, +/-3deg] driven by the
 *    pointer position over the wrapper. Smoothed via CSS transition.
 *
 * Both behaviors are no-ops when prefers-reduced-motion is on.
 */

type Props = {
  className?: string;
  children: ReactNode;
};

export function MotionMockupFrame({ className, children }: Props) {
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
      className={`motion-mockup-frame ${className ?? ""}`}
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.15, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </motion.div>
  );
}
