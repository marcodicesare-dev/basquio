// ─── LOCKED SLOT ARCHETYPES ────────────────────────────────────────
// Hard constraints per layout. The author fills named slots. The renderer
// places content deterministically. Content that exceeds slot budgets is
// rejected at write time, not fixed at render time.
//
// This is the single source of truth for what fits on a slide.

import { R, SLIDE_W, SLIDE_H } from "./layout-regions";

// ─── SLOT TYPES ──────────────────────────────────────────────────────

export type SlotKind =
  | "title"
  | "subtitle"
  | "kicker"
  | "body"
  | "bullets"
  | "chart"
  | "chart2"
  | "table"
  | "metrics"
  | "callout";

export type ChartSlotType =
  | "bar"
  | "stacked_bar"
  | "line"
  | "pie"
  | "doughnut"
  | "waterfall"
  | "scatter"
  | "area"
  | "grouped_bar"
  | "horizontal_bar";

export interface SlotConstraint {
  kind: SlotKind;
  frame: R;
  /** Max characters for text slots. Enforced at write time. */
  maxChars?: number;
  /** Max word count for body/bullets. */
  maxWords?: number;
  /** Max bullet count. */
  maxBullets?: number;
  /** Max metric cards. */
  maxMetrics?: number;
  /** Min metric cards. */
  minMetrics?: number;
  /** Allowed chart types for chart slots. */
  allowedChartTypes?: ChartSlotType[];
  /** Max chart categories (bars/slices/points). */
  maxCategories?: number;
  /** Max table rows (including header). */
  maxTableRows?: number;
  /** Max table columns. */
  maxTableCols?: number;
  /** Whether this slot is required. */
  required?: boolean;
  /** Font size range [min, max] in points. */
  fontRange?: [number, number];
}

export interface SlideArchetype {
  id: string;
  label: string;
  description: string;
  slots: Record<string, SlotConstraint>;
}

// ─── ARCHETYPE DEFINITIONS ───────────────────────────────────────────

const ARCHETYPES: Record<string, SlideArchetype> = {
  cover: {
    id: "cover",
    label: "Cover",
    description: "Opening slide with title and optional subtitle",
    slots: {
      title: {
        kind: "title",
        frame: { x: 0.45, y: 1.6, w: 9.1, h: 1.6 },
        maxChars: 140,
        maxWords: 20,
        required: true,
        fontRange: [24, 36],
      },
      subtitle: {
        kind: "subtitle",
        frame: { x: 0.45, y: 3.3, w: 9.1, h: 0.5 },
        maxChars: 80,
        fontRange: [14, 18],
      },
    },
  },

  "section-divider": {
    id: "section-divider",
    label: "Section Divider",
    description: "Section break with title and subtitle",
    slots: {
      title: {
        kind: "title",
        frame: { x: 0.45, y: 1.8, w: 9.1, h: 1.2 },
        maxChars: 80,
        required: true,
        fontRange: [28, 36],
      },
      subtitle: {
        kind: "subtitle",
        frame: { x: 0.45, y: 3.1, w: 9.1, h: 0.6 },
        maxChars: 120,
        fontRange: [14, 18],
      },
    },
  },

  "exec-summary": {
    id: "exec-summary",
    label: "Executive Summary",
    description: "KPI row + body text for high-level overview",
    slots: {
      title: {
        kind: "title",
        frame: { x: 0.45, y: 0.22, w: 9.1, h: 0.56 },
        maxChars: 120,
        required: true,
        fontRange: [16, 20],
      },
      metrics: {
        kind: "metrics",
        frame: { x: 0.45, y: 0.95, w: 9.1, h: 1.3 },
        minMetrics: 3,
        maxMetrics: 5,
        required: true,
      },
      body: {
        kind: "body",
        frame: { x: 0.45, y: 2.35, w: 9.1, h: 1.65 },
        maxWords: 60,
        maxChars: 400,
        fontRange: [11, 14],
      },
      callout: {
        kind: "callout",
        frame: { x: 0.45, y: 4.15, w: 9.1, h: 0.42 },
        maxWords: 20,
        maxChars: 120,
        fontRange: [10, 12],
      },
    },
  },

  "title-chart": {
    id: "title-chart",
    label: "Full-Width Chart",
    description: "Single chart with title and callout",
    slots: {
      kicker: {
        kind: "kicker",
        frame: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        maxChars: 40,
        fontRange: [8, 10],
      },
      title: {
        kind: "title",
        frame: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        maxChars: 120,
        required: true,
        fontRange: [16, 20],
      },
      chart: {
        kind: "chart",
        frame: { x: 0.35, y: 0.92, w: 9.25, h: 3.5 },
        required: true,
        maxCategories: 12,
        allowedChartTypes: ["bar", "stacked_bar", "line", "pie", "doughnut", "waterfall", "scatter", "area", "grouped_bar", "horizontal_bar"],
      },
      callout: {
        kind: "callout",
        frame: { x: 0.45, y: 4.55, w: 9.1, h: 0.42 },
        maxWords: 20,
        maxChars: 120,
        fontRange: [10, 12],
      },
    },
  },

  "chart-split": {
    id: "chart-split",
    label: "Chart + Insight",
    description: "Chart on the left, insight text on the right",
    slots: {
      kicker: {
        kind: "kicker",
        frame: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        maxChars: 40,
        fontRange: [8, 10],
      },
      title: {
        kind: "title",
        frame: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        maxChars: 120,
        required: true,
        fontRange: [16, 20],
      },
      chart: {
        kind: "chart",
        frame: { x: 0.35, y: 0.92, w: 5.75, h: 3.5 },
        required: true,
        maxCategories: 10,
        allowedChartTypes: ["bar", "stacked_bar", "line", "waterfall", "horizontal_bar", "grouped_bar"],
      },
      body: {
        kind: "body",
        frame: { x: 6.25, y: 0.92, w: 3.2, h: 2.6 },
        maxWords: 50,
        maxBullets: 4,
        maxChars: 320,
        required: true,
        fontRange: [10, 12],
      },
      callout: {
        kind: "callout",
        frame: { x: 6.25, y: 3.65, w: 3.2, h: 0.46 },
        maxWords: 15,
        maxChars: 90,
        fontRange: [9, 11],
      },
    },
  },

  "evidence-grid": {
    id: "evidence-grid",
    label: "Evidence Grid",
    description: "Metrics + chart + body for evidence-dense slides",
    slots: {
      kicker: {
        kind: "kicker",
        frame: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        maxChars: 40,
        fontRange: [8, 10],
      },
      title: {
        kind: "title",
        frame: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        maxChars: 120,
        required: true,
        fontRange: [16, 20],
      },
      metrics: {
        kind: "metrics",
        frame: { x: 0.45, y: 0.92, w: 9.1, h: 0.85 },
        minMetrics: 2,
        maxMetrics: 4,
      },
      chart: {
        kind: "chart",
        frame: { x: 0.35, y: 1.85, w: 5.75, h: 2.55 },
        maxCategories: 8,
        allowedChartTypes: ["bar", "stacked_bar", "line", "waterfall", "horizontal_bar", "grouped_bar", "pie", "doughnut"],
      },
      body: {
        kind: "body",
        frame: { x: 6.25, y: 1.85, w: 3.2, h: 2.55 },
        maxWords: 50,
        maxBullets: 4,
        maxChars: 320,
        fontRange: [10, 12],
      },
      callout: {
        kind: "callout",
        frame: { x: 0.45, y: 4.55, w: 9.1, h: 0.42 },
        maxWords: 20,
        maxChars: 120,
        fontRange: [10, 12],
      },
    },
  },

  "comparison": {
    id: "comparison",
    label: "Dual Chart Comparison",
    description: "Two charts side by side for direct comparison",
    slots: {
      kicker: {
        kind: "kicker",
        frame: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        maxChars: 40,
        fontRange: [8, 10],
      },
      title: {
        kind: "title",
        frame: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        maxChars: 120,
        required: true,
        fontRange: [16, 20],
      },
      chart: {
        kind: "chart",
        frame: { x: 0.35, y: 0.92, w: 4.55, h: 3.2 },
        required: true,
        maxCategories: 8,
        allowedChartTypes: ["bar", "stacked_bar", "line", "pie", "doughnut", "horizontal_bar"],
      },
      chart2: {
        kind: "chart2",
        frame: { x: 5.05, y: 0.92, w: 4.55, h: 3.2 },
        maxCategories: 8,
        allowedChartTypes: ["bar", "stacked_bar", "line", "pie", "doughnut", "horizontal_bar"],
      },
      callout: {
        kind: "callout",
        frame: { x: 0.45, y: 4.25, w: 9.1, h: 0.42 },
        maxWords: 20,
        maxChars: 120,
        fontRange: [10, 12],
      },
    },
  },

  "recommendation-cards": {
    id: "recommendation-cards",
    label: "Recommendation Cards",
    description: "Two disciplined action cards with reserved bands for index, title, body, and footer",
    slots: {
      kicker: {
        kind: "kicker",
        frame: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        maxChars: 40,
        fontRange: [8, 10],
      },
      title: {
        kind: "title",
        frame: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        maxChars: 110,
        required: true,
        fontRange: [16, 20],
      },
      body: {
        kind: "body",
        frame: { x: 0.45, y: 0.92, w: 9.1, h: 2.65 },
        maxWords: 70,
        maxChars: 420,
        required: true,
        fontRange: [10, 12],
      },
      metrics: {
        kind: "metrics",
        frame: { x: 0.45, y: 3.72, w: 9.1, h: 0.78 },
        minMetrics: 2,
        maxMetrics: 2,
        required: true,
      },
      callout: {
        kind: "callout",
        frame: { x: 0.45, y: 4.58, w: 9.1, h: 0.28 },
        maxWords: 14,
        maxChars: 90,
        fontRange: [9, 11],
      },
    },
  },

  "title-body": {
    id: "title-body",
    label: "Title + Body",
    description: "Full-width text slide for synthesis or recommendations",
    slots: {
      kicker: {
        kind: "kicker",
        frame: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        maxChars: 40,
        fontRange: [8, 10],
      },
      title: {
        kind: "title",
        frame: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        maxChars: 120,
        required: true,
        fontRange: [16, 20],
      },
      body: {
        kind: "body",
        frame: { x: 0.45, y: 0.92, w: 9.1, h: 3.5 },
        maxWords: 100,
        maxChars: 650,
        required: true,
        fontRange: [11, 14],
      },
      callout: {
        kind: "callout",
        frame: { x: 0.45, y: 4.55, w: 9.1, h: 0.42 },
        maxWords: 20,
        maxChars: 120,
        fontRange: [10, 12],
      },
    },
  },

  "title-bullets": {
    id: "title-bullets",
    label: "Title + Bullets",
    description: "Bullet-point slide for structured arguments",
    slots: {
      kicker: {
        kind: "kicker",
        frame: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        maxChars: 40,
        fontRange: [8, 10],
      },
      title: {
        kind: "title",
        frame: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        maxChars: 120,
        required: true,
        fontRange: [16, 20],
      },
      bullets: {
        kind: "bullets",
        frame: { x: 0.45, y: 0.92, w: 9.1, h: 3.5 },
        maxBullets: 5,
        maxChars: 500, // total across all bullets
        required: true,
        fontRange: [12, 14],
      },
      callout: {
        kind: "callout",
        frame: { x: 0.45, y: 4.55, w: 9.1, h: 0.42 },
        maxWords: 20,
        maxChars: 120,
        fontRange: [10, 12],
      },
    },
  },

  table: {
    id: "table",
    label: "Data Table",
    description: "Full-width data table with title",
    slots: {
      kicker: {
        kind: "kicker",
        frame: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        maxChars: 40,
        fontRange: [8, 10],
      },
      title: {
        kind: "title",
        frame: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        maxChars: 120,
        required: true,
        fontRange: [16, 20],
      },
      table: {
        kind: "table",
        frame: { x: 0.35, y: 0.92, w: 9.25, h: 3.95 },
        maxTableRows: 8,
        maxTableCols: 6,
        required: true,
      },
    },
  },

  summary: {
    id: "summary",
    label: "Summary / Recommendation",
    description: "Synthesis slide with body text and action callout",
    slots: {
      kicker: {
        kind: "kicker",
        frame: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        maxChars: 40,
        fontRange: [8, 10],
      },
      title: {
        kind: "title",
        frame: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        maxChars: 120,
        required: true,
        fontRange: [16, 20],
      },
      body: {
        kind: "body",
        frame: { x: 0.45, y: 0.92, w: 9.1, h: 2.4 },
        maxWords: 80,
        maxChars: 520,
        required: true,
        fontRange: [11, 14],
      },
      bullets: {
        kind: "bullets",
        frame: { x: 0.45, y: 3.45, w: 9.1, h: 0.95 },
        maxBullets: 3,
        maxChars: 200,
        fontRange: [11, 13],
      },
      callout: {
        kind: "callout",
        frame: { x: 0.45, y: 4.5, w: 9.1, h: 0.42 },
        maxWords: 20,
        maxChars: 120,
        fontRange: [10, 12],
      },
    },
  },

  // Map two-column to chart-split (same archetype)
  "two-column": {
    id: "two-column",
    label: "Two Column (Chart + Insight)",
    description: "Alias for chart-split",
    slots: {}, // Filled at runtime from chart-split
  },

  // Map metrics to exec-summary (same archetype)
  metrics: {
    id: "metrics",
    label: "Metrics Dashboard",
    description: "Alias for exec-summary",
    slots: {}, // Filled at runtime from exec-summary
  },
};

// Wire up aliases
ARCHETYPES["two-column"] = { ...ARCHETYPES["chart-split"], id: "two-column", label: "Two Column" };
ARCHETYPES["metrics"] = { ...ARCHETYPES["exec-summary"], id: "metrics", label: "Metrics Dashboard" };

// ─── PUBLIC API ──────────────────────────────────────────────────────

export function getArchetype(layoutId: string): SlideArchetype | undefined {
  return ARCHETYPES[layoutId];
}

export function getArchetypeOrDefault(layoutId: string): SlideArchetype {
  return ARCHETYPES[layoutId] ?? ARCHETYPES["title-body"];
}

export function listArchetypeIds(): string[] {
  return Object.keys(ARCHETYPES);
}

export function listArchetypes(): SlideArchetype[] {
  return Object.values(ARCHETYPES);
}

// ─── SLOT VALIDATION ─────────────────────────────────────────────────

export type SlotViolation = {
  slot: string;
  constraint: string;
  actual: string | number;
  limit: string | number;
};

/**
 * Validate slide content against the archetype's slot constraints.
 * Returns violations. Empty array = content fits.
 */
export function validateSlotConstraints(
  layoutId: string,
  content: {
    title?: string;
    subtitle?: string;
    kicker?: string;
    body?: string;
    bullets?: string[];
    chartId?: string;
    chartCategories?: number;
    chartType?: string;
    metrics?: unknown[];
    callout?: string;
    tableRows?: number;
    tableCols?: number;
  },
): SlotViolation[] {
  const arch = getArchetypeOrDefault(layoutId);
  const violations: SlotViolation[] = [];

  for (const [slotName, slot] of Object.entries(arch.slots)) {
    // Check required slots
    if (slot.required) {
      switch (slot.kind) {
        case "title":
          if (!content.title) violations.push({ slot: slotName, constraint: "required", actual: "missing", limit: "required" });
          break;
        case "chart":
          if (!content.chartId) violations.push({ slot: slotName, constraint: "required", actual: "missing", limit: "required" });
          break;
        case "body":
          if (!content.body && (!content.bullets || content.bullets.length === 0))
            violations.push({ slot: slotName, constraint: "required", actual: "missing", limit: "body or bullets" });
          break;
        case "bullets":
          if (!content.bullets || content.bullets.length === 0)
            violations.push({ slot: slotName, constraint: "required", actual: "missing", limit: "required" });
          break;
        case "metrics":
          if (!content.metrics || content.metrics.length === 0)
            violations.push({ slot: slotName, constraint: "required", actual: "missing", limit: "required" });
          break;
        case "table":
          if (!content.chartId)
            violations.push({ slot: slotName, constraint: "required", actual: "missing", limit: "table chart ID required" });
          break;
      }
    }

    // Check content limits
    if (slot.kind === "title" && content.title && slot.maxChars && content.title.length > slot.maxChars) {
      violations.push({ slot: slotName, constraint: "maxChars", actual: content.title.length, limit: slot.maxChars });
    }

    if (slot.kind === "subtitle" && content.subtitle && slot.maxChars && content.subtitle.length > slot.maxChars) {
      violations.push({ slot: slotName, constraint: "maxChars", actual: content.subtitle.length, limit: slot.maxChars });
    }

    if (slot.kind === "kicker" && content.kicker && slot.maxChars && content.kicker.length > slot.maxChars) {
      violations.push({ slot: slotName, constraint: "maxChars", actual: content.kicker.length, limit: slot.maxChars });
    }

    if (slot.kind === "body" && content.body) {
      if (slot.maxChars && content.body.length > slot.maxChars) {
        violations.push({ slot: slotName, constraint: "maxChars", actual: content.body.length, limit: slot.maxChars });
      }
      if (slot.maxWords) {
        const wordCount = content.body.split(/\s+/).filter(Boolean).length;
        if (wordCount > slot.maxWords) {
          violations.push({ slot: slotName, constraint: "maxWords", actual: wordCount, limit: slot.maxWords });
        }
      }
    }

    if (slot.kind === "bullets" && content.bullets) {
      if (slot.maxBullets && content.bullets.length > slot.maxBullets) {
        violations.push({ slot: slotName, constraint: "maxBullets", actual: content.bullets.length, limit: slot.maxBullets });
      }
      if (slot.maxChars) {
        const totalChars = content.bullets.join("").length;
        if (totalChars > slot.maxChars) {
          violations.push({ slot: slotName, constraint: "maxChars (total)", actual: totalChars, limit: slot.maxChars });
        }
      }
    }

    if (slot.kind === "callout" && content.callout) {
      if (slot.maxChars && content.callout.length > slot.maxChars) {
        violations.push({ slot: slotName, constraint: "maxChars", actual: content.callout.length, limit: slot.maxChars });
      }
      if (slot.maxWords) {
        const wordCount = content.callout.split(/\s+/).filter(Boolean).length;
        if (wordCount > slot.maxWords) {
          violations.push({ slot: slotName, constraint: "maxWords", actual: wordCount, limit: slot.maxWords });
        }
      }
    }

    if (slot.kind === "metrics" && content.metrics) {
      if (slot.maxMetrics && content.metrics.length > slot.maxMetrics) {
        violations.push({ slot: slotName, constraint: "maxMetrics", actual: content.metrics.length, limit: slot.maxMetrics });
      }
      if (slot.minMetrics && content.metrics.length < slot.minMetrics) {
        violations.push({ slot: slotName, constraint: "minMetrics", actual: content.metrics.length, limit: slot.minMetrics });
      }
    }

    if (slot.kind === "chart" || slot.kind === "chart2") {
      if (content.chartCategories && slot.maxCategories && content.chartCategories > slot.maxCategories) {
        violations.push({ slot: slotName, constraint: "maxCategories", actual: content.chartCategories, limit: slot.maxCategories });
      }
      if (content.chartType && slot.allowedChartTypes && !slot.allowedChartTypes.includes(content.chartType as ChartSlotType)) {
        violations.push({ slot: slotName, constraint: "allowedChartTypes", actual: content.chartType, limit: slot.allowedChartTypes.join(", ") });
      }
    }

    if (slot.kind === "table") {
      if (content.tableRows && slot.maxTableRows && content.tableRows > slot.maxTableRows) {
        violations.push({ slot: slotName, constraint: "maxTableRows", actual: content.tableRows, limit: slot.maxTableRows });
      }
      if (content.tableCols && slot.maxTableCols && content.tableCols > slot.maxTableCols) {
        violations.push({ slot: slotName, constraint: "maxTableCols", actual: content.tableCols, limit: slot.maxTableCols });
      }
    }
  }

  return violations;
}

/**
 * Build a human-readable slot budget description for the author prompt.
 * This tells the model exactly what fits in each layout.
 */
export function describeArchetypeForPrompt(layoutId: string): string {
  const arch = getArchetypeOrDefault(layoutId);
  const lines: string[] = [`Layout: ${arch.id} — ${arch.description}`];

  for (const [slotName, slot] of Object.entries(arch.slots)) {
    const parts: string[] = [`  ${slotName}${slot.required ? " (REQUIRED)" : ""}`];
    if (slot.maxChars) parts.push(`max ${slot.maxChars} chars`);
    if (slot.maxWords) parts.push(`max ${slot.maxWords} words`);
    if (slot.maxBullets) parts.push(`max ${slot.maxBullets} bullets`);
    if (slot.maxMetrics) parts.push(`${slot.minMetrics ?? 1}-${slot.maxMetrics} metrics`);
    if (slot.maxCategories) parts.push(`max ${slot.maxCategories} categories`);
    if (slot.maxTableRows) parts.push(`max ${slot.maxTableRows} rows`);
    if (slot.maxTableCols) parts.push(`max ${slot.maxTableCols} cols`);
    if (slot.allowedChartTypes) parts.push(`charts: ${slot.allowedChartTypes.join(", ")}`);
    lines.push(parts.join(" | "));
  }

  return lines.join("\n");
}

/**
 * Build a compact slot budget summary for ALL layouts.
 * Used in the author system prompt so it knows all constraints upfront.
 */
export function describeAllArchetypesForPrompt(): string {
  const lines: string[] = ["=== SLOT BUDGETS PER LAYOUT ===", "Content MUST fit these limits. Exceeding any limit will be rejected.", ""];

  for (const arch of Object.values(ARCHETYPES)) {
    // Skip aliases (they have empty slots that got replaced)
    if (arch.id === "two-column" || arch.id === "metrics") continue;

    lines.push(`[${arch.id}] ${arch.description}`);
    for (const [slotName, slot] of Object.entries(arch.slots)) {
      const limits: string[] = [];
      if (slot.required) limits.push("REQUIRED");
      if (slot.maxChars) limits.push(`≤${slot.maxChars}ch`);
      if (slot.maxWords) limits.push(`≤${slot.maxWords}w`);
      if (slot.maxBullets) limits.push(`≤${slot.maxBullets} bullets`);
      if (slot.maxMetrics) limits.push(`${slot.minMetrics ?? 1}-${slot.maxMetrics} cards`);
      if (slot.maxCategories) limits.push(`≤${slot.maxCategories} cats`);
      if (slot.maxTableRows) limits.push(`≤${slot.maxTableRows} rows`);
      lines.push(`  ${slotName}: ${limits.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
