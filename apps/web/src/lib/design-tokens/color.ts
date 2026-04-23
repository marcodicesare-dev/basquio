/**
 * Color palette (warm gray, Linear-aligned).
 *
 * Per docs/specs/2026-04-22-workspace-shell-ux-spec.md §3.3. Light and dark
 * themes are explicit objects rather than CSS variable indirection so
 * type-checking catches missing keys.
 *
 * Craft choice: no drop shadows, borders carry elevation. Light-theme
 * borders are rgba(0,0,0,x) so they compose cleanly over the cream canvas
 * without introducing a second accent hue. Dark-theme borders use warmer
 * grays (Linear March 2026 pattern) rather than cool blue-gray.
 *
 * Accent restraint: black-as-accent in light, white-as-accent in dark.
 * Indigo (#3a6df0 light, #5a85f5 dark) is reserved for links and focus;
 * it is not a primary brand color. Success / warning / danger use muted
 * tones so error states do not feel alarmist.
 *
 * Default theme for workspace: dark (per spec §14 Q1 answer 2026-04-23).
 * Light remains the default for marketing. prefers-color-scheme is the
 * tiebreaker for unauthenticated visitors.
 */
export const lightColor = {
  bg: {
    canvas: "#fefefe",
    surface: "#f7f7f6",
    sunken: "#efeeec",
    overlay: "rgba(255, 255, 255, 0.85)",
  },
  border: {
    subtle: "rgba(0, 0, 0, 0.05)",
    default: "rgba(0, 0, 0, 0.08)",
    strong: "rgba(0, 0, 0, 0.12)",
    focus: "#3a6df0",
  },
  text: {
    primary: "#1a1a1a",
    secondary: "#5b5b58",
    tertiary: "#8a8a85",
    onAccent: "#ffffff",
    placeholder: "#a8a8a3",
  },
  accent: {
    primary: "#1a1a1a",
    secondary: "#3a6df0",
    success: "#3a8a4d",
    warning: "#a06a1a",
    danger: "#b53e3e",
  },
} as const;

export const darkColor = {
  bg: {
    canvas: "#0e0e0d",
    surface: "#1a1a18",
    sunken: "#252522",
    overlay: "rgba(0, 0, 0, 0.85)",
  },
  border: {
    subtle: "rgba(255, 255, 255, 0.04)",
    default: "rgba(255, 255, 255, 0.07)",
    strong: "rgba(255, 255, 255, 0.11)",
    focus: "#5a85f5",
  },
  text: {
    primary: "#f5f5f4",
    secondary: "#b5b5b1",
    tertiary: "#7a7a76",
    onAccent: "#f5f5f4",
    placeholder: "#5a5a55",
  },
  accent: {
    primary: "#f5f5f4",
    secondary: "#5a85f5",
    success: "#5aa56d",
    warning: "#c08a3a",
    danger: "#d56565",
  },
} as const;

export type ThemePalette = typeof lightColor;
export type ThemeName = "light" | "dark";

export const WORKSPACE_DEFAULT_THEME: ThemeName = "dark";
export const MARKETING_DEFAULT_THEME: ThemeName = "light";
