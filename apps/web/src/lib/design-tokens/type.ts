/**
 * Type scale (1.25 modular, base 15px).
 *
 * Per docs/specs/2026-04-22-workspace-shell-ux-spec.md §3.2. Base size 15px
 * rather than the 16px default because the 1.25 ratio over 12px (caption)
 * produces 15 → 18.75 → 23.4 → 29.3 → 36.6 → 45.8, and the body sits at 15
 * so caption stays at 12 without forcing an awkward 12.8.
 *
 * Sub-pixel sizes (18.75, 23.4, 29.3, 36.6, 45.8) are honored to one
 * decimal place via CSS rem. True 1.25-ratio values are 18.75, 23.4375,
 * 29.296875, 36.62, 45.78; we round once per step rather than rounding
 * every step back to an integer, because browsers anti-alias sub-pixel
 * sizes correctly and rounding to integers would leak off-rhythm headings.
 *
 * Line-height rules: 1.47 (22/15) at body for Notion-paragraph density;
 * tighter ratios (1.3, 1.15) at subtitle, h-levels, hero because larger
 * sizes need less lead to feel composed.
 *
 * Tracking gets tighter as size grows. -0.025em at hero is the Linear
 * convention for display sizes above 40px.
 */
export const type = {
  caption: { size: "12px", line: "16px", weight: 500, tracking: "0.01em" },
  body: { size: "15px", line: "22px", weight: 400, tracking: "0" },
  label: { size: "13px", line: "18px", weight: 500, tracking: "0.01em" },
  subtitle: { size: "18.75px", line: "26px", weight: 500, tracking: "-0.005em" },
  h3: { size: "23.4px", line: "30px", weight: 600, tracking: "-0.01em" },
  h2: { size: "29.3px", line: "36px", weight: 600, tracking: "-0.015em" },
  h1: { size: "36.6px", line: "44px", weight: 700, tracking: "-0.02em" },
  hero: { size: "45.8px", line: "52px", weight: 700, tracking: "-0.025em" },
} as const;

export type TypeKey = keyof typeof type;
export type TypeValue = (typeof type)[TypeKey];
