/**
 * Spacing scale (8pt grid, 4pt sub-grid).
 *
 * Per docs/specs/2026-04-22-workspace-shell-ux-spec.md §3.1. The powers-of-8
 * values (2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32) are the spine. The bridges
 * (3, 5) exist so compact components can breathe without breaking rhythm.
 *
 * Deliberate non-defaults (craft notes per Rule 3):
 * - No 18px or 28px. Every gap on production surfaces snaps to this scale.
 * - 56px (space[14]) is the sidebar icon-rail width; 280px and 320px
 *   are not indexed here because they're shell-specific layout widths,
 *   not general spacing.
 *
 * Edge case: dense data tables and mobile-narrow contexts may use space[1]
 * (4px) inside components flagged density="compact". Anywhere else, space[2]
 * (8px) is the minimum gap.
 */
export const space = {
  px: "1px",
  0.5: "2px",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  14: "56px",
  16: "64px",
  20: "80px",
  24: "96px",
  32: "128px",
} as const;

export type SpaceKey = keyof typeof space;
export type SpaceValue = (typeof space)[SpaceKey];
