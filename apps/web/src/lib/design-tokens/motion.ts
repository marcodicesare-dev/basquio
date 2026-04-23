/**
 * Motion primitives.
 *
 * Per docs/specs/2026-04-22-workspace-shell-ux-spec.md §3.5 plus the
 * banned-animations list in §8.8. These tokens feed both CSS `transition`
 * strings and Motion v12 `motion.div` configs.
 *
 * Craft rules:
 * - spring is reserved for moments of human delight (approval confirmation,
 *   deck-ready notification). Daily interactions stay on ease.out. Spring
 *   on every click reads as juvenile per memory golden rules.
 * - no animation above 800ms unless it is a deliberate hero reveal.
 * - no continuous loops outside the dedicated Spinner component.
 * - wobbly springs (stiffness < 120) and bouncy easing on functional UI
 *   are banned. The `spring` entry below is a cubic-bezier approximation
 *   for CSS; Motion v12 consumers should prefer the `spring` configs
 *   below under `spring.soft / standard / snappy`.
 *
 * Latency budget defaults live in §3.6 of the spec and are enforced by
 * the latency checks in the shell spec §12.10 acceptance criteria.
 */
export const motion = {
  ease: {
    out: "cubic-bezier(0.2, 0, 0.38, 0.9)",
    inOut: "cubic-bezier(0.4, 0, 0.2, 1)",
    spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  },
  duration: {
    instant: "80ms",
    fast: "180ms",
    medium: "260ms",
    slow: "400ms",
    deliberate: "640ms",
  },
  spring: {
    soft: { type: "spring" as const, stiffness: 180, damping: 28, mass: 1 },
    standard: { type: "spring" as const, stiffness: 220, damping: 24, mass: 1 },
    snappy: { type: "spring" as const, stiffness: 320, damping: 30, mass: 0.9 },
  },
} as const;

/**
 * Reduced-motion policy. When `prefers-reduced-motion: reduce` is set,
 * consumers should fall back to `ease.out` with `duration.fast`, skeletons
 * go static (no opacity pulse), and View Transitions are disabled. This
 * constant is a convenience for components to pass into a motion hook.
 */
export const reducedMotion = {
  ease: motion.ease.out,
  duration: motion.duration.fast,
} as const;

export type MotionEase = keyof typeof motion.ease;
export type MotionDuration = keyof typeof motion.duration;
export type MotionSpring = keyof typeof motion.spring;
