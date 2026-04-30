"use client";

import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { motion, type Variants } from "motion/react";

/**
 * Section head with sequential reveal of children (eyebrow → title → body → link).
 * Triggers once when the head enters viewport.
 *
 * Uses vanilla IntersectionObserver to flip an inView state, which then drives
 * motion's animate prop. Motion's whileInView was unreliable in our nesting.
 */

const containerVariants: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.04 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
  },
};

type Props = {
  className?: string;
  id?: string;
  children: ReactNode;
};

export function MotionSectionHead({ className, id, children }: Props) {
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

  return (
    <motion.div
      ref={ref}
      className={className}
      id={id}
      variants={containerVariants}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
    >
      {Children.map(children, (child, i) => (
        <motion.div key={i} variants={itemVariants} style={{ width: "100%" }}>
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}
