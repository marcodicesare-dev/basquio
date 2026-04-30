"use client";

import { Children, type ReactNode } from "react";
import { motion, type Variants } from "motion/react";

/**
 * Section head with sequential reveal of children (eyebrow → title → body → link).
 * Triggers once when the head enters viewport.
 *
 * Each top-level child is wrapped in a motion.div with stagger + fade-up. The
 * containing flex column layout from .section-j-stack-head still applies because
 * flex column treats wrapping divs as direct children.
 */

const containerVariants: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.04,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.55,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};

type Props = {
  className?: string;
  id?: string;
  children: ReactNode;
};

export function MotionSectionHead({ className, id, children }: Props) {
  return (
    <motion.div
      className={className}
      id={id}
      variants={containerVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.15, margin: "0px 0px -10% 0px" }}
    >
      {Children.map(children, (child, i) => (
        <motion.div key={i} variants={itemVariants} style={{ width: "100%" }}>
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}
