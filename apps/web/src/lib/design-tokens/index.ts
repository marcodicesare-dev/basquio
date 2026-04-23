/**
 * Design tokens barrel. Import from this entrypoint instead of deep-linking
 * to the individual files so future refactors can move or split primitives
 * without breaking consumer imports.
 *
 * Per docs/specs/2026-04-22-workspace-shell-ux-spec.md §3. Every primitive
 * here is the single source of truth for its concern; component code must
 * not hardcode spacing, sizes, colors, radii, durations, or breakpoints
 * that are not in this module.
 */
export { space } from "./space";
export type { SpaceKey, SpaceValue } from "./space";

export { type } from "./type";
export type { TypeKey, TypeValue } from "./type";

export {
  lightColor,
  darkColor,
  WORKSPACE_DEFAULT_THEME,
  MARKETING_DEFAULT_THEME,
} from "./color";
export type { ThemePalette, ThemeName } from "./color";

export { radius } from "./radius";
export type { RadiusKey, RadiusValue } from "./radius";

export { motion, reducedMotion } from "./motion";
export type { MotionEase, MotionDuration, MotionSpring } from "./motion";

export { breakpoint, mediaQuery } from "./breakpoint";
export type { BreakpointName, MediaQueryName } from "./breakpoint";
