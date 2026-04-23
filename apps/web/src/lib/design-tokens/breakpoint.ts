/**
 * Viewport breakpoints.
 *
 * Per docs/specs/2026-04-22-workspace-shell-ux-spec.md §10.1. The shell
 * uses container queries where possible and viewport media queries where
 * a component's behavior depends on the whole viewport (sidebar collapse,
 * aside panel visibility).
 *
 * Rationale for the specific cuts:
 * - 640px = iPad mini portrait, the smallest viewport where the sidebar
 *   icon rail can coexist with a usable main column.
 * - 1024px = standard tablet landscape plus 13-inch laptops at scale 1.
 * - 1280px = smallest viewport where all three zones (sidebar 280 + main
 *   720 + aside 320) fit without overlap.
 * - 1536px = the "wide" breakpoint for 16-inch MacBooks and larger,
 *   where the main column gains extra padding rather than growing.
 */
export const breakpoint = {
  mobile: { min: 0, max: 639 },
  tablet: { min: 640, max: 1023 },
  laptop: { min: 1024, max: 1279 },
  desktop: { min: 1280, max: 1535 },
  wide: { min: 1536, max: Infinity },
} as const;

export type BreakpointName = keyof typeof breakpoint;

/** CSS media query helpers for use in styled-components or CSS-in-JS. */
export const mediaQuery = {
  mobileOnly: "(max-width: 639px)",
  tabletUp: "(min-width: 640px)",
  laptopUp: "(min-width: 1024px)",
  desktopUp: "(min-width: 1280px)",
  wideUp: "(min-width: 1536px)",
} as const;

export type MediaQueryName = keyof typeof mediaQuery;
