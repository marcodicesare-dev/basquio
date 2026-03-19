/**
 * Shape-built chart renderer for universal cross-app compatibility.
 * Uses PptxGenJS shapes (addShape + addText) instead of native OOXML charts.
 * Works identically in PowerPoint, Google Slides, and Keynote.
 *
 * This is the consulting-firm approach (McKinsey/BCG): charts are drawn
 * as grouped rectangles + text, not embedded chart objects.
 *
 * Chart rendering rules are driven by the chart design system archetypes.
 */
import PptxGenJS from "pptxgenjs";
import { resolveChartArchetype } from "@basquio/scene-graph/chart-design-system";

// ─── TYPES ───────────────────────────────────────────────────────

export interface ShapeChartData {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
  }>;
}

export interface ShapeChartFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShapeChartTokens {
  accent: string;
  ink: string;
  muted: string;
  surface: string;
  chartPalette: string[];
  bodyFont: string;
  headingFont: string;
}

export interface ShapeChartOptions {
  title?: string;
  sourceNote?: string;
  focalEntity?: string;
  unit?: string;
  highlightCategories?: string[];
  showLegend?: boolean;
  benchmarkValue?: number;
  benchmarkLabel?: string;
}

// ─── CONSTANTS ───────────────────────────────────────────────────

// ─── DESIGN SYSTEM TOKENS (Tremor/shadcn-level polish) ──────────
// These define the visual grammar for all chart types.
// Comparable to a web chart library's theme but for PPTX shapes.

const V = {
  // Colors — Dark-mode tokens from basquio-deck-templates-v3.jsx
  mutedBar: "272630",        // Non-focal bars/segments (border color, subtle on dark)
  labelGray: "6B6A72",       // Axis labels, category labels (JSX: textDim)
  gridGray: "1F1E28",        // Grid lines (JSX: borderSubtle — barely visible on dark)
  axisGray: "272630",        // Axis lines (JSX: border — subtle on dark)
  borderGray: "272630",      // Card/component borders (JSX: border)
  surfaceGray: "16151E",     // Card backgrounds, zebra rows (JSX: card)
  // Semantic colors (from JSX design system)
  green: "4CC9A0",           // JSX: green — positive, growth
  red: "E8636F",             // JSX: red — negative, decline
  // Typography sizes (pt)
  chartTitle: 10,            // Chart title above chart area
  dataLabel: 10,             // Values on bars/points (bold)
  catLabel: 9,               // Category labels on axes
  legend: 8.5,               // Legend text
  source: 8,                 // Source note below chart
  insideLabel: 8,            // Labels inside bar segments
  annotation: 8,             // Benchmark/reference labels
  // Spacing (inches)
  titleAreaH: 0.22,          // Height reserved for chart title
  sourceAreaH: 0.18,         // Height reserved for source note
  labelAreaW: 1.8,           // Width for horizontal bar category labels
  labelAreaWNarrow: 1.4,     // Narrow variant for dense charts
  axisAreaH: 0.32,           // Height for vertical chart axis labels
  valueLabelW: 0.60,         // Width for value labels at bar end
  barGapRatio: 0.35,         // Gap between bars as ratio of slot height
  barPadding: 0.02,          // Internal padding within grouped bars
  legendH: 0.18,             // Height of legend row
  cardPadH: 0.06,            // Horizontal cell padding
  cardPadV: 0.04,            // Vertical cell padding
  // Stroke
  gridLinePt: 0.005,         // Grid line thickness in inches
  axisLinePt: 0.007,         // Axis line thickness
  // Limits
  maxCategories: 12,
  maxLabelChars: 25,
  maxSlices: 6,              // Max pie/donut slices before rollup
} as const;

// Legacy aliases for backward compat
const MUTED_BAR = V.mutedBar;
const LABEL_GRAY = V.labelGray;
const GRID_GRAY = V.gridGray;
const AXIS_GRAY = V.axisGray;
const GREEN = V.green;
const RED = V.red;
const DATA_LABEL_SIZE = V.dataLabel;
const CAT_LABEL_SIZE = V.catLabel;
const LEGEND_SIZE = V.legend;
const TITLE_SIZE = V.chartTitle;
const SOURCE_SIZE = V.source;
const MAX_CATEGORIES = V.maxCategories;
const MAX_LABEL_CHARS = V.maxLabelChars;

// ─── ROUTER ──────────────────────────────────────────────────────

export function renderShapeChart(
  slide: PptxGenJS.Slide,
  chartType: string,
  data: ShapeChartData,
  frame: ShapeChartFrame,
  tokens: ShapeChartTokens,
  options: ShapeChartOptions = {},
): void {
  if (!data || !data.labels || data.labels.length === 0) return;
  if (!data.datasets || data.datasets.length === 0) return;

  // Resolve archetype rendering rules from the design system
  const archetype = resolveChartArchetype(chartType);
  const rules = archetype.renderingRules;

  // Enforce max categories from archetype constraints
  if (data.labels.length > archetype.constraints.maxCategories) {
    data = {
      ...data,
      labels: data.labels.slice(0, archetype.constraints.maxCategories),
      datasets: data.datasets.map((ds) => ({
        ...ds,
        data: ds.data.slice(0, archetype.constraints.maxCategories),
      })),
    };
  }

  // Apply sort policy from archetype
  if (rules.sortBars === "desc" && data.datasets.length === 1) {
    const pairs = data.labels.map((l, i) => ({ label: l, value: data.datasets[0].data[i] ?? 0 }));
    pairs.sort((a, b) => b.value - a.value);
    data = {
      ...data,
      labels: pairs.map((p) => p.label),
      datasets: [{ ...data.datasets[0], data: pairs.map((p) => p.value) }],
    };
  } else if (rules.sortBars === "asc" && data.datasets.length === 1) {
    const pairs = data.labels.map((l, i) => ({ label: l, value: data.datasets[0].data[i] ?? 0 }));
    pairs.sort((a, b) => a.value - b.value);
    data = {
      ...data,
      labels: pairs.map((p) => p.label),
      datasets: [{ ...data.datasets[0], data: pairs.map((p) => p.value) }],
    };
  }

  // Reserve space for title and source
  const titleH = options.title ? 0.22 : 0;
  const sourceH = options.sourceNote ? 0.18 : 0;
  const chartFrame: ShapeChartFrame = {
    x: frame.x,
    y: frame.y + titleH,
    w: frame.w,
    h: frame.h - titleH - sourceH,
  };

  // Render title above chart
  if (options.title) {
    slide.addText(options.title, {
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: 0.20,
      fontSize: TITLE_SIZE,
      fontFace: tokens.bodyFont,
      color: tokens.accent,
      bold: true,
      align: "left",
      valign: "bottom",
    });
  }

  // Render source below chart
  if (options.sourceNote) {
    slide.addText(options.sourceNote, {
      x: frame.x,
      y: frame.y + frame.h - 0.16,
      w: frame.w,
      h: 0.14,
      fontSize: SOURCE_SIZE,
      fontFace: tokens.bodyFont,
      color: "9CA3AF",
      align: "left",
      valign: "top",
    });
  }

  const normalized = chartType.toLowerCase().replace(/[_\s]/g, "-");

  if (normalized.includes("horizontal") || normalized === "bar") {
    renderHorizontalBar(slide, data, chartFrame, tokens, options);
  } else if (normalized.includes("vertical") || normalized === "column" || normalized === "bar-vertical") {
    renderVerticalBar(slide, data, chartFrame, tokens, options);
  } else if (normalized.includes("grouped")) {
    // Grouped bar = vertical bar with multi-series support
    renderVerticalBar(slide, data, chartFrame, tokens, options);
  } else if (normalized.includes("100%") || normalized.includes("percent")) {
    renderStackedBar(slide, data, chartFrame, tokens, options, true);
  } else if (normalized.includes("stack")) {
    renderStackedBar(slide, data, chartFrame, tokens, options, false);
  } else if (normalized.includes("waterfall") || normalized.includes("bridge")) {
    renderWaterfall(slide, data, chartFrame, tokens, options);
  } else if (normalized.includes("donut") || normalized.includes("doughnut")) {
    renderDonut(slide, data, chartFrame, tokens, options);
  } else if (normalized.includes("pie")) {
    renderPie(slide, data, chartFrame, tokens, options);
  } else if (normalized.includes("line") || normalized.includes("trend")) {
    renderLineChart(slide, data, chartFrame, tokens, options);
  } else if (normalized.includes("scatter") || normalized.includes("bubble") || normalized.includes("quadrant")) {
    renderScatterChart(slide, data, chartFrame, tokens, options);
  } else if (normalized.includes("area")) {
    // Area charts: render as line chart with filled columns below each point
    renderAreaChart(slide, data, chartFrame, tokens, options);
  } else if (normalized.includes("funnel")) {
    renderFunnel(slide, data, chartFrame, tokens, options);
  } else if (normalized.includes("table") || normalized.includes("matrix")) {
    // Tables/matrices: render as a data table
    renderDataTable(slide, data, chartFrame, tokens, options);
  } else {
    // Unknown chart type: render as data table with a note about the chart type
    // This is better than silently forcing a horizontal bar which may misrepresent the data
    renderDataTable(slide, data, chartFrame, tokens, { ...options, title: options.title ? `${options.title} (${chartType})` : chartType });
  }
}

// ─── HORIZONTAL BAR CHART ────────────────────────────────────────

function renderHorizontalBar(
  slide: PptxGenJS.Slide,
  data: ShapeChartData,
  frame: ShapeChartFrame,
  tokens: ShapeChartTokens,
  options: ShapeChartOptions,
): void {
  const values = data.datasets[0].data;

  // Pair, sort descending, truncate
  let pairs = data.labels.map((label, i) => ({ label, value: values[i] ?? 0 }));
  pairs.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  if (pairs.length > V.maxCategories) {
    const rest = pairs.slice(V.maxCategories - 1);
    const restSum = rest.reduce((s, p) => s + p.value, 0);
    pairs = [...pairs.slice(0, V.maxCategories - 1), { label: `${rest.length} others`, value: restSum }];
  }

  const maxVal = Math.max(...pairs.map((p) => Math.abs(p.value)), 1);
  const labelAreaW = pairs.length > 8 ? V.labelAreaWNarrow : V.labelAreaW;
  const chartAreaX = frame.x + labelAreaW;
  const chartAreaW = frame.w - labelAreaW - V.valueLabelW;
  const n = pairs.length;
  const slotH = frame.h / n;
  const barH = slotH * (1 - V.barGapRatio);
  const gapH = slotH * V.barGapRatio;

  const isFocal = (label: string) =>
    options.focalEntity && label.toLowerCase().includes(options.focalEntity.toLowerCase());
  const isHighlighted = (label: string) =>
    options.highlightCategories?.some((h) => label.toLowerCase().includes(h.toLowerCase()));

  // Subtle vertical grid lines (25%, 50%, 75%, 100% marks)
  for (let g = 1; g <= 4; g++) {
    const gridX = chartAreaX + (chartAreaW * g) / 4;
    // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
      x: gridX, y: frame.y, w: V.gridLinePt, h: frame.h,
      fill: { color: V.gridGray },
    });
  }

  // Thin baseline at chart left edge
  // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
    x: chartAreaX, y: frame.y, w: V.axisLinePt, h: frame.h,
    fill: { color: V.axisGray },
  });

  pairs.forEach((pair, i) => {
    const y = frame.y + i * slotH + gapH / 2;
    const barW = (Math.abs(pair.value) / maxVal) * chartAreaW;
    const focal = isFocal(pair.label) || isHighlighted(pair.label);
    const color = focal ? tokens.accent : V.mutedBar;

    // Category label — bold for focal, regular for others
    slide.addText(truncLabel(pair.label), {
      x: frame.x,
      y,
      w: labelAreaW - 0.10,
      h: barH,
      fontSize: V.catLabel,
      fontFace: tokens.bodyFont,
      color: focal ? tokens.ink : V.labelGray,
      bold: focal,
      align: "right",
      valign: "middle",
    });

    // Bar with micro-padding from baseline
    if (barW > 0.01) {
      // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
        x: chartAreaX + 0.02,
        y: y + V.barPadding,
        w: barW - 0.02,
        h: barH - V.barPadding * 2,
        fill: { color },
      });
    }

    // Value label — always shown, bold, positioned at bar end
    slide.addText(formatValue(pair.value, options.unit), {
      x: chartAreaX + barW + 0.06,
      y,
      w: V.valueLabelW - 0.08,
      h: barH,
      fontSize: V.dataLabel,
      fontFace: tokens.bodyFont,
      color: focal ? tokens.ink : V.labelGray,
      bold: true,
      align: "left",
      valign: "middle",
    });
  });

  // Benchmark reference line (dashed vertical line at benchmark value)
  if (options.benchmarkValue != null && maxVal > 0) {
    const bmX = chartAreaX + (options.benchmarkValue / maxVal) * chartAreaW;
    // Dashed line (rendered as thin rect since PptxGenJS shapes don't support dash)
    for (let dy = 0; dy < frame.h; dy += 0.08) {
      // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
        x: bmX - 0.003, y: frame.y + dy, w: 0.006, h: 0.04,
        fill: { color: V.labelGray },
      });
    }
    // Benchmark label
    if (options.benchmarkLabel) {
      slide.addText(options.benchmarkLabel, {
        x: bmX - 0.5, y: frame.y - 0.18, w: 1.0, h: 0.16,
        fontSize: V.annotation, fontFace: tokens.bodyFont,
        color: V.labelGray, align: "center", valign: "bottom",
      });
    }
  }
}

// ─── VERTICAL BAR CHART ──────────────────────────────────────────

function renderVerticalBar(
  slide: PptxGenJS.Slide,
  data: ShapeChartData,
  frame: ShapeChartFrame,
  tokens: ShapeChartTokens,
  options: ShapeChartOptions,
): void {
  const labels = data.labels.slice(0, V.maxCategories);
  const datasets = data.datasets;
  const isGrouped = datasets.length > 1;
  const palette = tokens.chartPalette.length > 0 ? tokens.chartPalette : [tokens.accent, V.mutedBar, "93C5FD", "FCA5A5"];

  const allVals = datasets.flatMap((ds) => ds.data.slice(0, labels.length));
  const maxVal = Math.max(...allVals.map((v) => Math.abs(v)), 1);

  const chartAreaH = frame.h - V.axisAreaH - 0.20;
  const chartAreaY = frame.y + 0.20;
  const n = labels.length;
  const groupW = frame.w / n;
  const groupGap = groupW * 0.18;
  const usableGroupW = groupW - groupGap;
  const seriesCount = isGrouped ? datasets.length : 1;
  const barW = usableGroupW / seriesCount;

  const isFocal = (label: string) =>
    options.focalEntity && label.toLowerCase().includes(options.focalEntity.toLowerCase());

  // Subtle horizontal grid lines
  for (let g = 1; g <= 4; g++) {
    const gridY = chartAreaY + chartAreaH - (chartAreaH * g) / 4;
    // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
      x: frame.x, y: gridY, w: frame.w, h: V.gridLinePt,
      fill: { color: V.gridGray },
    });
  }

  // Baseline
  // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
    x: frame.x, y: chartAreaY + chartAreaH, w: frame.w, h: V.axisLinePt,
    fill: { color: V.axisGray },
  });

  labels.forEach((label, i) => {
    const groupX = frame.x + i * groupW + groupGap / 2;

    datasets.forEach((ds, di) => {
      const val = ds.data[i] ?? 0;
      const barH = (Math.abs(val) / maxVal) * chartAreaH;
      const barY = chartAreaY + chartAreaH - barH;
      const barX = groupX + di * barW + V.barPadding;
      const focal = !isGrouped && isFocal(label);
      const color = isGrouped ? palette[di % palette.length] : (focal ? tokens.accent : V.mutedBar);

      if (barH > 0.01) {
        // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
          x: barX, y: barY, w: barW - V.barPadding * 2, h: barH,
          fill: { color },
        });
      }

      // Value label on top
      if (!isGrouped || barW > 0.35) {
        slide.addText(formatValue(val, options.unit), {
          x: barX - 0.05, y: barY - 0.22, w: barW + 0.1, h: 0.20,
          fontSize: isGrouped ? V.dataLabel - 2 : V.dataLabel,
          fontFace: tokens.bodyFont, color: focal ? tokens.ink : V.labelGray,
          bold: true, align: "center", valign: "bottom",
        });
      }
    });

    // Category label below baseline
    slide.addText(truncLabel(label), {
      x: groupX, y: chartAreaY + chartAreaH + 0.03, w: usableGroupW, h: V.axisAreaH - 0.06,
      fontSize: V.catLabel - 1, fontFace: tokens.bodyFont,
      color: V.labelGray, align: "center", valign: "top",
    });
  });

  // Legend for multi-series
  if (isGrouped) {
    renderLegend(slide, datasets.map((ds, i) => ({
      label: ds.label, color: palette[i % palette.length],
    })), { x: frame.x, y: frame.y + frame.h - V.legendH, w: frame.w }, tokens);
  }
}

// ─── STACKED BAR CHART ───────────────────────────────────────────

function renderStackedBar(
  slide: PptxGenJS.Slide,
  data: ShapeChartData,
  frame: ShapeChartFrame,
  tokens: ShapeChartTokens,
  options: ShapeChartOptions,
  normalize100 = false,
): void {
  const labels = data.labels.slice(0, V.maxCategories);
  const datasets = data.datasets;
  const palette = tokens.chartPalette.length > 0 ? tokens.chartPalette : [tokens.accent, V.mutedBar, "93C5FD", "FCA5A5", "86EFAC"];

  const totals = labels.map((_, i) =>
    datasets.reduce((sum, ds) => sum + (ds.data[i] ?? 0), 0),
  );
  const maxTotal = normalize100 ? 1 : Math.max(...totals, 1);

  const labelAreaW = V.labelAreaWNarrow;
  const chartAreaX = frame.x + labelAreaW;
  const chartAreaW = frame.w - labelAreaW - 0.1;
  const n = labels.length;
  const slotH = frame.h / n;
  const barH = slotH * (1 - V.barGapRatio);
  const gapH = slotH * V.barGapRatio;

  labels.forEach((label, i) => {
    const y = frame.y + i * slotH + gapH / 2;
    let offsetX = 0;

    // Category label
    slide.addText(truncLabel(label), {
      x: frame.x, y, w: labelAreaW - 0.08, h: barH,
      fontSize: V.catLabel, fontFace: tokens.bodyFont,
      color: V.labelGray, align: "right", valign: "middle",
    });

    datasets.forEach((ds, di) => {
      const val = ds.data[i] ?? 0;
      const segW = normalize100
        ? (totals[i] > 0 ? (val / totals[i]) * chartAreaW : 0)
        : (val / maxTotal) * chartAreaW;

      if (segW > 0.01) {
        // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
          x: chartAreaX + offsetX, y: y + V.barPadding,
          w: segW, h: barH - V.barPadding * 2,
          fill: { color: palette[di % palette.length] },
        });

        // Label inside segment if wide enough (percentage or value)
        const pct = totals[i] > 0 ? (val / totals[i]) * 100 : 0;
        if (pct >= 15 && segW > 0.35) {
          slide.addText(normalize100 ? `${Math.round(pct)}%` : formatValue(val, options.unit), {
            x: chartAreaX + offsetX,
            y,
            w: segW,
            h: barH,
            fontSize: 8,
            fontFace: tokens.bodyFont,
            color: "FFFFFF",
            bold: true,
            align: "center",
            valign: "middle",
          });
        }
      }
      offsetX += segW;
    });
  });

  // Legend
  if (datasets.length > 1) {
    renderLegend(slide, datasets.map((ds, i) => ({
      label: ds.label,
      color: palette[i % palette.length],
    })), { x: frame.x + labelAreaW, y: frame.y + frame.h - V.legendH, w: chartAreaW }, tokens);
  }
}

// ─── WATERFALL CHART ─────────────────────────────────────────────

function renderWaterfall(
  slide: PptxGenJS.Slide,
  data: ShapeChartData,
  frame: ShapeChartFrame,
  tokens: ShapeChartTokens,
  options: ShapeChartOptions,
): void {
  const values = data.datasets[0].data;
  const labels = data.labels.slice(0, MAX_CATEGORIES);
  const vals = values.slice(0, MAX_CATEGORIES);

  // Compute running total and max for scaling
  let running = 0;
  const segments: Array<{ label: string; start: number; end: number; isTotal: boolean }> = [];

  vals.forEach((v, i) => {
    const lbl = labels[i].toLowerCase();
    const isTotal = lbl.includes("total") || lbl.includes("net") || i === vals.length - 1;

    if (isTotal) {
      segments.push({ label: labels[i], start: 0, end: running + v, isTotal: true });
    } else {
      const start = running;
      running += v;
      segments.push({ label: labels[i], start, end: running, isTotal: false });
    }
  });

  const allVals = segments.flatMap((s) => [s.start, s.end]);
  const minVal = Math.min(...allVals, 0);
  const maxVal = Math.max(...allVals, 1);
  const range = maxVal - minVal || 1;

  const axisAreaH = 0.35;
  const labelAreaH = 0.25;
  const chartAreaH = frame.h - axisAreaH - labelAreaH;
  const chartAreaY = frame.y + labelAreaH;
  const n = segments.length;
  const barW = (frame.w / n) * 0.55;
  const gap = (frame.w / n) * 0.45;

  segments.forEach((seg, i) => {
    const x = frame.x + i * (barW + gap) + gap / 2;
    const top = Math.max(seg.start, seg.end);
    const bottom = Math.min(seg.start, seg.end);
    const barH = ((top - bottom) / range) * chartAreaH;
    const barY = chartAreaY + chartAreaH - ((top - minVal) / range) * chartAreaH;

    const isPositive = seg.end >= seg.start;
    const color = seg.isTotal ? tokens.accent : isPositive ? GREEN : RED;

    // Bar
    if (barH > 0.005) {
      // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
        x,
        y: barY,
        w: barW,
        h: barH,
        fill: { color },
      });
    }

    // Value label
    slide.addText(formatValue(seg.end - seg.start, options.unit), {
      x,
      y: barY - labelAreaH,
      w: barW,
      h: labelAreaH,
      fontSize: DATA_LABEL_SIZE - 1,
      fontFace: tokens.bodyFont,
      color: tokens.ink,
      bold: true,
      align: "center",
      valign: "bottom",
    });

    // Category label
    slide.addText(truncLabel(seg.label), {
      x,
      y: chartAreaY + chartAreaH + 0.02,
      w: barW,
      h: axisAreaH - 0.04,
      fontSize: CAT_LABEL_SIZE - 1,
      fontFace: tokens.bodyFont,
      color: LABEL_GRAY,
      align: "center",
      valign: "top",
    });

    // Connector line to next bar
    if (i < segments.length - 1 && !seg.isTotal) {
      const nextSeg = segments[i + 1];
      const connectorY = chartAreaY + chartAreaH - ((seg.end - minVal) / range) * chartAreaH;
      if (!nextSeg.isTotal) {
        // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
          x: x + barW,
          y: connectorY,
          w: gap,
          h: 0.005,
          fill: { color: AXIS_GRAY },
        });
      }
    }
  });
}

// ─── DONUT CHART ─────────────────────────────────────────────────

function renderDonut(
  slide: PptxGenJS.Slide,
  data: ShapeChartData,
  frame: ShapeChartFrame,
  tokens: ShapeChartTokens,
  options: ShapeChartOptions,
): void {
  renderArcChart(slide, data, frame, tokens, options, 0.55);
}

// ─── PIE CHART ───────────────────────────────────────────────────

function renderPie(
  slide: PptxGenJS.Slide,
  data: ShapeChartData,
  frame: ShapeChartFrame,
  tokens: ShapeChartTokens,
  options: ShapeChartOptions,
): void {
  renderArcChart(slide, data, frame, tokens, options, 1.0);
}

// ─── SHARED ARC CHART (PIE / DONUT) ─────────────────────────────

function renderArcChart(
  slide: PptxGenJS.Slide,
  data: ShapeChartData,
  frame: ShapeChartFrame,
  tokens: ShapeChartTokens,
  options: ShapeChartOptions,
  _thicknessRatio: number,
): void {
  const values = data.datasets[0].data;
  let slices = data.labels.map((label, i) => ({ label, value: values[i] ?? 0 }));

  // Roll up small slices, sort descending
  slices.sort((a, b) => b.value - a.value);
  if (slices.length > V.maxSlices) {
    const top = slices.slice(0, V.maxSlices - 1);
    const rest = slices.slice(V.maxSlices - 1);
    slices = [...top, { label: "Other", value: rest.reduce((s, p) => s + p.value, 0) }];
  }

  const total = slices.reduce((s, p) => s + p.value, 0);
  if (total === 0) return;

  const palette = tokens.chartPalette.length > 0 ? tokens.chartPalette : [tokens.accent, V.mutedBar, "93C5FD", "FCA5A5", "86EFAC", "FDE68A"];

  // Composition chart: horizontal proportion bars with labels
  // This is the consulting-grade approach — clearer than pie/donut, works everywhere
  const rowH = Math.min(0.42, frame.h / slices.length);
  const rowGap = Math.min(0.08, (frame.h - rowH * slices.length) / Math.max(slices.length - 1, 1));
  const barAreaX = frame.x + 0.05;
  const barAreaW = frame.w * 0.55;
  const labelAreaX = barAreaX + barAreaW + 0.12;
  const labelAreaW = frame.w - barAreaW - 0.22;

  // Full-width background bar (100% reference)
  slices.forEach((slc, i) => {
    const y = frame.y + i * (rowH + rowGap);
    const color = palette[i % palette.length];
    const pct = Math.round((slc.value / total) * 100);
    const barW = (slc.value / total) * barAreaW;

    // Background track (subtle)
    // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
      x: barAreaX, y: y + rowH * 0.25, w: barAreaW, h: rowH * 0.50,
      fill: { color: V.surfaceGray },
    });

    // Value bar
    if (barW > 0.01) {
      // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
        x: barAreaX, y: y + rowH * 0.25, w: barW, h: rowH * 0.50,
        fill: { color },
      });
    }

    // Label row: swatch + name + percentage + absolute value
    // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
      x: labelAreaX, y: y + rowH * 0.30, w: 0.14, h: 0.14,
      fill: { color },
    });

    slide.addText(
      [
        { text: `${truncLabel(slc.label)}  `, options: { fontSize: V.dataLabel, color: tokens.ink } },
        { text: `${pct}%`, options: { fontSize: V.dataLabel + 1, bold: true, color: tokens.ink } },
        { text: `  (${formatValue(slc.value, options.unit)})`, options: { fontSize: V.catLabel, color: V.labelGray } },
      ],
      {
        x: labelAreaX + 0.20,
        y,
        w: labelAreaW - 0.25,
        h: 0.28,
        fontFace: tokens.bodyFont,
        valign: "middle",
      },
    );

  });
}

// ─── LINE CHART (connected dots) ─────────────────────────────────

function renderLineChart(
  slide: PptxGenJS.Slide,
  data: ShapeChartData,
  frame: ShapeChartFrame,
  tokens: ShapeChartTokens,
  options: ShapeChartOptions,
): void {
  const labels = data.labels.slice(0, MAX_CATEGORIES);
  const palette = tokens.chartPalette.length > 0 ? tokens.chartPalette : [tokens.accent, MUTED_BAR];
  const axisH = 0.30;
  const chartH = frame.h - axisH - 0.20;
  const chartY = frame.y + 0.20;

  // Find global min/max across all datasets
  const allVals = data.datasets.flatMap((ds) => ds.data.slice(0, labels.length));
  const minVal = Math.min(...allVals, 0);
  const maxVal = Math.max(...allVals, 1);
  const range = maxVal - minVal || 1;

  // Grid lines
  for (let g = 1; g <= 3; g++) {
    const gridY = chartY + chartH - (chartH * g) / 4;
    // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
      x: frame.x, y: gridY, w: frame.w, h: 0.005,
      fill: { color: GRID_GRAY },
    });
  }

  data.datasets.forEach((ds, di) => {
    const color = palette[di % palette.length];
    const vals = ds.data.slice(0, labels.length);

    // Draw line segments and data points
    vals.forEach((val, i) => {
      const x = frame.x + (i / Math.max(labels.length - 1, 1)) * frame.w;
      const y = chartY + chartH - ((val - minVal) / range) * chartH;

      // Data point (circle approximated with small square)
      // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
        x: x - 0.04, y: y - 0.04, w: 0.08, h: 0.08,
        fill: { color },
        rectRadius: 0.04,
      });

      // Line to next point (proper diagonal line, not rectangle)
      if (i < vals.length - 1) {
        const nextX = frame.x + ((i + 1) / Math.max(labels.length - 1, 1)) * frame.w;
        const nextY = chartY + chartH - ((vals[i + 1] - minVal) / range) * chartH;
        slide.addShape("line" as unknown as PptxGenJS.ShapeType, {
          x, y, w: nextX - x, h: nextY - y,
          line: { color, width: 2.5 },
        });
      }

      // Value label on first, last, and highlighted points
      if (i === 0 || i === vals.length - 1) {
        slide.addText(formatValue(val, options.unit), {
          x: x - 0.3, y: y - 0.25, w: 0.6, h: 0.20,
          fontSize: DATA_LABEL_SIZE - 1, fontFace: tokens.bodyFont,
          color: tokens.ink, bold: true, align: "center",
        });
      }
    });
  });

  // Category labels
  labels.forEach((label, i) => {
    const x = frame.x + (i / Math.max(labels.length - 1, 1)) * frame.w;
    slide.addText(truncLabel(label), {
      x: x - 0.4, y: chartY + chartH + 0.02, w: 0.8, h: axisH - 0.04,
      fontSize: CAT_LABEL_SIZE - 1, fontFace: tokens.bodyFont,
      color: LABEL_GRAY, align: "center", valign: "top",
    });
  });

  // Legend for multi-series
  if (data.datasets.length > 1) {
    renderLegend(slide, data.datasets.map((ds, i) => ({
      label: ds.label, color: palette[i % palette.length],
    })), { x: frame.x, y: frame.y + frame.h - 0.18, w: frame.w }, tokens);
  }
}

// ─── SCATTER CHART ───────────────────────────────────────────────

// ─── AREA CHART ─────────────────────────────────────────────────

function renderAreaChart(
  slide: PptxGenJS.Slide,
  data: ShapeChartData,
  frame: ShapeChartFrame,
  tokens: ShapeChartTokens,
  options: ShapeChartOptions,
): void {
  const labels = data.labels.slice(0, MAX_CATEGORIES);
  const palette = tokens.chartPalette.length > 0 ? tokens.chartPalette : [tokens.accent, MUTED_BAR];
  const axisH = 0.30;
  const chartH = frame.h - axisH - 0.20;
  const chartY = frame.y + 0.20;

  const allVals = data.datasets.flatMap((ds) => ds.data.slice(0, labels.length));
  const minVal = Math.min(...allVals, 0);
  const maxVal = Math.max(...allVals, 1);
  const range = maxVal - minVal || 1;

  // Grid lines
  for (let g = 1; g <= 3; g++) {
    const gridY = chartY + chartH - (chartH * g) / 4;
    // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
      x: frame.x, y: gridY, w: frame.w, h: 0.005,
      fill: { color: GRID_GRAY },
    });
  }

  // Baseline
  const baselineY = chartY + chartH;
  // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
    x: frame.x, y: baselineY, w: frame.w, h: V.axisLinePt,
    fill: { color: AXIS_GRAY },
  });

  // For each dataset: draw filled columns from baseline to data point, then lines on top
  data.datasets.forEach((ds, di) => {
    const color = palette[di % palette.length];
    const vals = ds.data.slice(0, labels.length);

    // Filled area approximation: thin vertical bars from baseline to each point
    vals.forEach((val, i) => {
      const x = frame.x + (i / Math.max(labels.length - 1, 1)) * frame.w;
      const y = chartY + chartH - ((val - minVal) / range) * chartH;
      const fillH = baselineY - y;
      const barW = frame.w / labels.length * 0.9;

      if (fillH > 0.01) {
        // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
          x: x - barW / 2, y, w: barW, h: fillH,
          fill: { color, transparency: 70 }, // 70% transparent for area effect
        });
      }
    });

    // Line connecting points on top
    vals.forEach((val, i) => {
      if (i >= vals.length - 1) return;
      const x = frame.x + (i / Math.max(labels.length - 1, 1)) * frame.w;
      const y = chartY + chartH - ((val - minVal) / range) * chartH;
      const nextX = frame.x + ((i + 1) / Math.max(labels.length - 1, 1)) * frame.w;
      const nextY = chartY + chartH - ((vals[i + 1] - minVal) / range) * chartH;

      slide.addShape("line" as unknown as PptxGenJS.ShapeType, {
        x, y, w: nextX - x, h: nextY - y,
        line: { color, width: 2.5 },
      });
    });

    // Data points
    vals.forEach((val, i) => {
      const x = frame.x + (i / Math.max(labels.length - 1, 1)) * frame.w;
      const y = chartY + chartH - ((val - minVal) / range) * chartH;

      // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
        x: x - 0.04, y: y - 0.04, w: 0.08, h: 0.08,
        fill: { color },
        rectRadius: 0.04,
      });

      // Labels on first and last
      if (i === 0 || i === vals.length - 1) {
        slide.addText(formatValue(val, options.unit), {
          x: x - 0.3, y: y - 0.25, w: 0.6, h: 0.20,
          fontSize: DATA_LABEL_SIZE - 1, fontFace: tokens.bodyFont,
          color: tokens.ink, bold: true, align: "center",
        });
      }
    });
  });

  // Category labels
  labels.forEach((label, i) => {
    const x = frame.x + (i / Math.max(labels.length - 1, 1)) * frame.w;
    slide.addText(truncLabel(label), {
      x: x - 0.4, y: chartY + chartH + 0.02, w: 0.8, h: axisH - 0.04,
      fontSize: CAT_LABEL_SIZE - 1, fontFace: tokens.bodyFont,
      color: LABEL_GRAY, align: "center", valign: "top",
    });
  });

  // Legend for multi-series
  if (data.datasets.length > 1) {
    renderLegend(slide, data.datasets.map((ds, i) => ({
      label: ds.label,
      color: palette[i % palette.length],
    })), { x: frame.x, y: frame.y + frame.h - V.legendH, w: frame.w }, tokens);
  }
}

// ─── SCATTER / QUADRANT CHART ───────────────────────────────────

function renderScatterChart(
  slide: PptxGenJS.Slide,
  data: ShapeChartData,
  frame: ShapeChartFrame,
  tokens: ShapeChartTokens,
  options: ShapeChartOptions,
): void {
  // Scatter: labels are X values, first dataset is Y values
  const xVals = data.labels.map((l) => parseFloat(l) || 0);
  const yVals = data.datasets[0]?.data ?? [];
  const n = Math.min(xVals.length, yVals.length, MAX_CATEGORIES);

  const minX = Math.min(...xVals.slice(0, n));
  const maxX = Math.max(...xVals.slice(0, n));
  const minY = Math.min(...yVals.slice(0, n));
  const maxY = Math.max(...yVals.slice(0, n));
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const pad = 0.3;
  const chartX = frame.x + pad;
  const chartW = frame.w - pad * 2;
  const chartY = frame.y + pad;
  const chartH = frame.h - pad * 2;

  // Quadrant lines (if quadrant chart)
  const midX = chartX + chartW / 2;
  const midY = chartY + chartH / 2;
  // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
    x: midX, y: chartY, w: 0.005, h: chartH, fill: { color: AXIS_GRAY },
  });
  // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
    x: chartX, y: midY, w: chartW, h: 0.005, fill: { color: AXIS_GRAY },
  });

  // Use second dataset labels for entity names if available
  const entityLabels = data.datasets.length > 1
    ? data.datasets[1].data.map((_, i) => data.labels[i] ?? `${i + 1}`)
    : data.labels;

  const isFocal = (label: string) =>
    options.focalEntity && label.toLowerCase().includes(options.focalEntity.toLowerCase());
  const isHighlighted = (label: string) =>
    options.highlightCategories?.some((h) => label.toLowerCase().includes(h.toLowerCase()));

  for (let i = 0; i < n; i++) {
    const px = chartX + ((xVals[i] - minX) / rangeX) * chartW;
    const py = chartY + chartH - ((yVals[i] - minY) / rangeY) * chartH;
    const label = entityLabels[i] ?? `${i + 1}`;
    const focal = isFocal(label) || isHighlighted(label);
    const dotColor = focal ? tokens.accent : MUTED_BAR;
    const dotSize = focal ? 0.12 : 0.08;

    // Data point (circle)
    // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
      x: px - dotSize / 2, y: py - dotSize / 2, w: dotSize, h: dotSize,
      fill: { color: dotColor },
      rectRadius: dotSize / 2,
    });

    // Entity label next to dot (offset right and up)
    if (n <= 15) {
      slide.addText(truncLabel(label), {
        x: px + dotSize / 2 + 0.04,
        y: py - 0.10,
        w: 1.0,
        h: 0.20,
        fontSize: V.catLabel - 1,
        fontFace: tokens.bodyFont,
        color: focal ? tokens.ink : LABEL_GRAY,
        bold: focal,
        align: "left",
        valign: "middle",
      });
    }
  }
}

// ─── FUNNEL CHART ────────────────────────────────────────────────

function renderFunnel(
  slide: PptxGenJS.Slide,
  data: ShapeChartData,
  frame: ShapeChartFrame,
  tokens: ShapeChartTokens,
  options: ShapeChartOptions,
): void {
  const values = data.datasets[0].data;
  const labels = data.labels.slice(0, 8);
  const vals = values.slice(0, 8);
  const maxVal = Math.max(...vals, 1);
  const n = labels.length;
  const barH = (frame.h / n) * 0.75;
  const gap = (frame.h / n) * 0.25;
  const palette = tokens.chartPalette.length > 0 ? tokens.chartPalette : [tokens.accent, MUTED_BAR];

  labels.forEach((label, i) => {
    const y = frame.y + i * (barH + gap);
    const barW = (vals[i] / maxVal) * frame.w * 0.85;
    const barX = frame.x + (frame.w - barW) / 2; // Center each bar
    const color = palette[i % palette.length];

    // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
      x: barX, y, w: barW, h: barH,
      fill: { color },
    });

    // Label + value centered on bar
    slide.addText(`${truncLabel(label)}  ${formatValue(vals[i], options.unit)}`, {
      x: barX, y, w: barW, h: barH,
      fontSize: DATA_LABEL_SIZE, fontFace: tokens.bodyFont,
      color: "FFFFFF", bold: true, align: "center", valign: "middle",
    });
  });
}

// ─── DATA TABLE (for matrix/table chart types) ──────────────────

function renderDataTable(
  slide: PptxGenJS.Slide,
  data: ShapeChartData,
  frame: ShapeChartFrame,
  tokens: ShapeChartTokens,
  _options: ShapeChartOptions,
): void {
  const labels = data.labels.slice(0, 8);
  const datasets = data.datasets;
  const headerRow = ["", ...datasets.map((ds) => ds.label)];
  const maxCols = Math.min(headerRow.length, 7);

  const rowH = 0.28;
  const colW = frame.w / maxCols;
  const maxRows = Math.min(labels.length, Math.floor(frame.h / rowH) - 1);

  // Header
  headerRow.slice(0, maxCols).forEach((h, ci) => {
    slide.addText(truncLabel(h), {
      x: frame.x + ci * colW, y: frame.y, w: colW, h: rowH,
      fontSize: 9, fontFace: tokens.bodyFont, color: "FFFFFF", bold: true,
      fill: { color: tokens.accent }, align: ci === 0 ? "left" : "right", valign: "middle",
    });
  });

  // Data rows
  labels.slice(0, maxRows).forEach((label, ri) => {
    const rowY = frame.y + (ri + 1) * rowH;
    const bg = ri % 2 === 0 ? tokens.surface : V.surfaceGray;

    // Label column
    slide.addText(truncLabel(label), {
      x: frame.x, y: rowY, w: colW, h: rowH,
      fontSize: 9, fontFace: tokens.bodyFont, color: tokens.ink, bold: true,
      fill: { color: bg }, align: "left", valign: "middle",
    });

    // Data columns
    datasets.slice(0, maxCols - 1).forEach((ds, ci) => {
      slide.addText(formatValue(ds.data[ri] ?? 0), {
        x: frame.x + (ci + 1) * colW, y: rowY, w: colW, h: rowH,
        fontSize: 9, fontFace: tokens.bodyFont, color: tokens.ink,
        fill: { color: bg }, align: "right", valign: "middle",
      });
    });
  });
}

// ─── LEGEND ──────────────────────────────────────────────────────

function renderLegend(
  slide: PptxGenJS.Slide,
  items: Array<{ label: string; color: string }>,
  frame: { x: number; y: number; w: number },
  tokens: ShapeChartTokens,
): void {
  let offsetX = 0;
  items.forEach((item) => {
    // Color swatch
    // Use addText("") instead of addShape("rect") for Keynote compatibility.
  // PptxGenJS addShape produces empty <a:ln/> and missing <p:txBody>, which Keynote ignores.
  slide.addText("", {
      x: frame.x + offsetX,
      y: frame.y + 0.02,
      w: 0.12,
      h: 0.12,
      fill: { color: item.color },
    });

    // Label
    const labelW = Math.min(item.label.length * 0.065 + 0.15, 1.5);
    slide.addText(item.label, {
      x: frame.x + offsetX + 0.16,
      y: frame.y,
      w: labelW,
      h: 0.16,
      fontSize: LEGEND_SIZE,
      fontFace: tokens.bodyFont,
      color: LABEL_GRAY,
      valign: "middle",
    });

    offsetX += labelW + 0.25;
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────

function truncLabel(label: string): string {
  if (label.length <= MAX_LABEL_CHARS) return label;
  return label.slice(0, MAX_LABEL_CHARS - 1) + "…";
}

function formatValue(value: number, unit?: string): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  let formatted: string;
  if (abs >= 1_000_000_000) {
    formatted = `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  } else if (abs >= 1_000_000) {
    formatted = `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  } else if (abs >= 1_000) {
    formatted = `${sign}${(abs / 1_000).toFixed(1)}K`;
  } else if (abs === Math.floor(abs)) {
    formatted = `${sign}${abs}`;
  } else {
    formatted = `${sign}${abs.toFixed(1)}`;
  }

  if (unit === "%" || unit === "pp") return `${formatted}${unit}`;
  if (unit === "€" || unit === "$" || unit === "£") return `${unit}${formatted}`;
  if (unit) return `${formatted} ${unit}`;
  return formatted;
}
