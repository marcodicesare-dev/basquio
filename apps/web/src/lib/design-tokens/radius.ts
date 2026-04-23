/**
 * Border radius scale.
 *
 * Per docs/specs/2026-04-22-workspace-shell-ux-spec.md §3.4. The Linear
 * March 2026 refresh softened defaults away from 8px to 6px for buttons
 * and cards. Default `sm` (6px) is what most surfaces use; `lg` (12px)
 * is reserved for hero-level cards and the right-side drawer.
 *
 * Avoid `full` (9999px) except for avatars, badges, and pills. Rounding
 * an ordinary panel to a pill shape reads as juvenile per the craft
 * rules in memory/feedback_design_golden_rules.md Rule 3.
 */
export const radius = {
  none: "0",
  xs: "4px",
  sm: "6px",
  md: "8px",
  lg: "12px",
  full: "9999px",
} as const;

export type RadiusKey = keyof typeof radius;
export type RadiusValue = (typeof radius)[RadiusKey];
