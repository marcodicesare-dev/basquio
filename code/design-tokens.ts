/**
 * Shared Basquio design tokens — single source of truth for PPTX + PDF renderers.
 * Ported from basquio-deck-templates-v7.jsx.
 */

// ─── CHART PALETTE ─────────────────────────────────────────────
export const BASQUIO_CHART_PALETTE = [
  "F0CC27",  // brand amber
  "1A6AFF",  // brand ultramarine
  "4CC9A0",  // green — positive / secondary
  "9B7AE0",  // purple — accent
  "E8636F",  // red — danger / competitor
  "5AC4D4",  // cyan — highlight
  "6B7280",  // brand slate
  "7ABBE0",  // light blue variant
];

// ─── SEMANTIC COLORS ───────────────────────────────────────────
export const BASQUIO_COLORS = {
  bg: "0A090D",
  surface: "13121A",
  surfaceAlt: "1A1922",
  card: "16151E",
  border: "272630",
  borderSubtle: "1F1E28",
  text: "F2F0EB",
  textSec: "A09FA6",
  textDim: "6B6A72",
  amber: "F0CC27",
  amberDim: "C4A71F",
  green: "4CC9A0",
  greenDim: "2D8F6E",
  red: "E8636F",
  redDim: "B84A54",
  blue: "1A6AFF",
  purple: "9B7AE0",
  cyan: "5AC4D4",
  teal: "3AAFB0",
} as const;

// ─── TYPOGRAPHY ────────────────────────────────────────────────
// PPTX-safe font fallbacks for JSX web fonts
export const BASQUIO_FONTS = {
  serif: "Georgia",          // Playfair Display fallback
  sans: "Arial",             // DM Sans fallback
  mono: "Courier New",       // JetBrains Mono fallback
} as const;

// ─── HEATMAP COLOR TIERS ───────────────────────────────────────
export function heatmapColor(value: number): { fg: string; bg: string } {
  if (value >= 80) return { fg: BASQUIO_COLORS.green, bg: "1A2E24" };
  if (value >= 60) return { fg: BASQUIO_COLORS.amber, bg: "2D2618" };
  return { fg: BASQUIO_COLORS.red, bg: "2E1A1C" };
}

// ─── CSS VARIABLES (for PDF HTML renderer) ─────────────────────
export function basquioCssVariables(): string {
  return `
    --bg: #${BASQUIO_COLORS.bg};
    --surface: #${BASQUIO_COLORS.surface};
    --surface-alt: #${BASQUIO_COLORS.surfaceAlt};
    --card: #${BASQUIO_COLORS.card};
    --border: #${BASQUIO_COLORS.border};
    --text: #${BASQUIO_COLORS.text};
    --text-sec: #${BASQUIO_COLORS.textSec};
    --text-dim: #${BASQUIO_COLORS.textDim};
    --amber: #${BASQUIO_COLORS.amber};
    --green: #${BASQUIO_COLORS.green};
    --red: #${BASQUIO_COLORS.red};
    --blue: #${BASQUIO_COLORS.blue};
    --purple: #${BASQUIO_COLORS.purple};
    --font-serif: ${BASQUIO_FONTS.serif};
    --font-sans: ${BASQUIO_FONTS.sans};
    --font-mono: ${BASQUIO_FONTS.mono};
  `.trim();
}
