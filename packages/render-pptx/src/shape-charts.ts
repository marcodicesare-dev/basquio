/**
 * Shape-built chart renderer for universal cross-app compatibility.
 * Uses PptxGenJS shapes (addShape + addText) instead of native OOXML charts.
 * Works identically in PowerPoint, Google Slides, and Keynote.
 *
 * This is the consulting-firm approach (McKinsey/BCG): charts are drawn
 * as grouped rectangles + text, not embedded chart objects.
 */
import PptxGenJS from "pptxgenjs";

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
}

// ─── CONSTANTS ───────────────────────────────────────────────────

const MUTED_BAR = "D1D5DB";
const LABEL_GRAY = "6B7280";
const GRID_GRAY = "F3F4F6";
const AXIS_GRAY = "D1D5DB";
const GREEN = "16A34A";
const RED = "DC2626";
const DATA_LABEL_SIZE = 10;
const CAT_LABEL_SIZE = 9;
const LEGEND_SIZE = 8.5;
const TITLE_SIZE = 10;
const SOURCE_SIZE = 7;
const MAX_CATEGORIES = 12;
const MAX_LABEL_CHARS = 25;

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
  } else if (normalized.includes("stack")) {
    renderStackedBar(slide, data, chartFrame, tokens, options);
  } else if (normalized.includes("waterfall") || normalized.includes("bridge")) {
    renderWaterfall(slide, data, chartFrame, tokens, options);
  } else if (normalized.includes("donut") || normalized.includes("doughnut")) {
    renderDonut(slide, data, chartFrame, tokens, options);
  } else if (normalized.includes("pie")) {
    renderPie(slide, data, chartFrame, tokens, options);
  } else {
    // Default: horizontal bar (most common consulting chart)
    renderHorizontalBar(slide, data, chartFrame, tokens, options);
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
  let labels = data.labels;

  // Pair, sort descending, truncate
  let pairs = labels.map((label, i) => ({ label, value: values[i] ?? 0 }));
  pairs.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  if (pairs.length > MAX_CATEGORIES) {
    const rest = pairs.slice(MAX_CATEGORIES - 1);
    const restSum = rest.reduce((s, p) => s + p.value, 0);
    pairs = [...pairs.slice(0, MAX_CATEGORIES - 1), { label: `${rest.length} others`, value: restSum }];
  }

  const maxVal = Math.max(...pairs.map((p) => Math.abs(p.value)), 1);
  const labelAreaW = 1.8; // space for category labels
  const chartAreaX = frame.x + labelAreaW;
  const chartAreaW = frame.w - labelAreaW - 0.6; // 0.6 for value labels
  const n = pairs.length;
  const totalH = frame.h;
  const barH = (totalH / n) * 0.65;
  const gap = (totalH / n) * 0.35;

  const isFocal = (label: string) =>
    options.focalEntity && label.toLowerCase().includes(options.focalEntity.toLowerCase());
  const isHighlighted = (label: string) =>
    options.highlightCategories?.some((h) => label.toLowerCase().includes(h.toLowerCase()));

  pairs.forEach((pair, i) => {
    const y = frame.y + i * (barH + gap) + gap / 2;
    const barW = (Math.abs(pair.value) / maxVal) * chartAreaW;
    const color = isFocal(pair.label) || isHighlighted(pair.label) ? tokens.accent : MUTED_BAR;

    // Category label
    slide.addText(truncLabel(pair.label), {
      x: frame.x,
      y,
      w: labelAreaW - 0.08,
      h: barH,
      fontSize: CAT_LABEL_SIZE,
      fontFace: tokens.bodyFont,
      color: LABEL_GRAY,
      align: "right",
      valign: "middle",
    });

    // Bar
    if (barW > 0.01) {
      slide.addShape("rect" as unknown as PptxGenJS.ShapeType, {
        x: chartAreaX,
        y,
        w: barW,
        h: barH,
        fill: { color },
      });
    }

    // Value label
    slide.addText(formatValue(pair.value, options.unit), {
      x: chartAreaX + barW + 0.05,
      y,
      w: 0.55,
      h: barH,
      fontSize: DATA_LABEL_SIZE,
      fontFace: tokens.bodyFont,
      color: tokens.ink,
      bold: true,
      align: "left",
      valign: "middle",
    });
  });
}

// ─── VERTICAL BAR CHART ──────────────────────────────────────────

function renderVerticalBar(
  slide: PptxGenJS.Slide,
  data: ShapeChartData,
  frame: ShapeChartFrame,
  tokens: ShapeChartTokens,
  options: ShapeChartOptions,
): void {
  const values = data.datasets[0].data;
  let labels = data.labels.slice(0, MAX_CATEGORIES);
  const vals = values.slice(0, MAX_CATEGORIES);

  const maxVal = Math.max(...vals.map((v) => Math.abs(v)), 1);
  const axisAreaH = 0.35; // space for category labels at bottom
  const labelAreaH = 0.25; // space for value labels on top
  const chartAreaH = frame.h - axisAreaH - labelAreaH;
  const chartAreaY = frame.y + labelAreaH;
  const n = labels.length;
  const totalW = frame.w;
  const barW = (totalW / n) * 0.65;
  const gap = (totalW / n) * 0.35;

  const isFocal = (label: string) =>
    options.focalEntity && label.toLowerCase().includes(options.focalEntity.toLowerCase());

  // Horizontal grid lines (3 lines)
  for (let g = 1; g <= 3; g++) {
    const gridY = chartAreaY + chartAreaH - (chartAreaH * g) / 4;
    slide.addShape("rect" as unknown as PptxGenJS.ShapeType, {
      x: frame.x,
      y: gridY,
      w: frame.w,
      h: 0.005,
      fill: { color: GRID_GRAY },
    });
  }

  labels.forEach((label, i) => {
    const x = frame.x + i * (barW + gap) + gap / 2;
    const barH = (Math.abs(vals[i]) / maxVal) * chartAreaH;
    const barY = chartAreaY + chartAreaH - barH;
    const color = isFocal(label) ? tokens.accent : MUTED_BAR;

    // Bar
    if (barH > 0.01) {
      slide.addShape("rect" as unknown as PptxGenJS.ShapeType, {
        x,
        y: barY,
        w: barW,
        h: barH,
        fill: { color },
      });
    }

    // Value label on top
    slide.addText(formatValue(vals[i], options.unit), {
      x,
      y: barY - labelAreaH,
      w: barW,
      h: labelAreaH,
      fontSize: DATA_LABEL_SIZE,
      fontFace: tokens.bodyFont,
      color: tokens.ink,
      bold: true,
      align: "center",
      valign: "bottom",
    });

    // Category label below
    slide.addText(truncLabel(label), {
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
  });
}

// ─── STACKED BAR CHART ───────────────────────────────────────────

function renderStackedBar(
  slide: PptxGenJS.Slide,
  data: ShapeChartData,
  frame: ShapeChartFrame,
  tokens: ShapeChartTokens,
  options: ShapeChartOptions,
): void {
  const labels = data.labels.slice(0, MAX_CATEGORIES);
  const datasets = data.datasets;
  const palette = tokens.chartPalette.length > 0 ? tokens.chartPalette : [tokens.accent, MUTED_BAR, "93C5FD", "FCA5A5", "86EFAC"];

  // Compute totals for each category
  const totals = labels.map((_, i) =>
    datasets.reduce((sum, ds) => sum + (ds.data[i] ?? 0), 0),
  );
  const maxTotal = Math.max(...totals, 1);

  const labelAreaW = 1.6;
  const chartAreaX = frame.x + labelAreaW;
  const chartAreaW = frame.w - labelAreaW - 0.1;
  const n = labels.length;
  const barH = (frame.h / n) * 0.65;
  const gap = (frame.h / n) * 0.35;

  labels.forEach((label, i) => {
    const y = frame.y + i * (barH + gap) + gap / 2;
    let offsetX = 0;

    // Category label
    slide.addText(truncLabel(label), {
      x: frame.x,
      y,
      w: labelAreaW - 0.08,
      h: barH,
      fontSize: CAT_LABEL_SIZE,
      fontFace: tokens.bodyFont,
      color: LABEL_GRAY,
      align: "right",
      valign: "middle",
    });

    datasets.forEach((ds, di) => {
      const val = ds.data[i] ?? 0;
      const segW = (val / maxTotal) * chartAreaW;

      if (segW > 0.01) {
        slide.addShape("rect" as unknown as PptxGenJS.ShapeType, {
          x: chartAreaX + offsetX,
          y,
          w: segW,
          h: barH,
          fill: { color: palette[di % palette.length] },
        });

        // Label inside segment if wide enough
        const pct = totals[i] > 0 ? (val / totals[i]) * 100 : 0;
        if (pct >= 15 && segW > 0.4) {
          slide.addText(`${Math.round(pct)}%`, {
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
    })), { x: frame.x + labelAreaW, y: frame.y + frame.h - 0.18, w: chartAreaW }, tokens);
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
      slide.addShape("rect" as unknown as PptxGenJS.ShapeType, {
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
        slide.addShape("rect" as unknown as PptxGenJS.ShapeType, {
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
  thicknessRatio: number,
): void {
  const maxSlices = thicknessRatio < 1 ? 6 : 5;
  const values = data.datasets[0].data;
  let slices = data.labels.map((label, i) => ({ label, value: values[i] ?? 0 }));

  // Roll up small slices into "Other"
  if (slices.length > maxSlices) {
    slices.sort((a, b) => b.value - a.value);
    const top = slices.slice(0, maxSlices - 1);
    const rest = slices.slice(maxSlices - 1);
    const restSum = rest.reduce((s, p) => s + p.value, 0);
    slices = [...top, { label: "Other", value: restSum }];
  }

  const total = slices.reduce((s, p) => s + p.value, 0);
  if (total === 0) return;

  const palette = tokens.chartPalette.length > 0 ? tokens.chartPalette : [tokens.accent, MUTED_BAR, "93C5FD", "FCA5A5", "86EFAC", "FDE68A"];

  // Chart takes left 60%, legend takes right 40%
  const chartDiameter = Math.min(frame.w * 0.55, frame.h * 0.9);
  const centerX = frame.x + chartDiameter / 2 + 0.1;
  const centerY = frame.y + frame.h / 2;
  const radius = chartDiameter / 2;

  let startAngle = -90; // Start from top

  slices.forEach((slc, i) => {
    const sweepAngle = (slc.value / total) * 360;
    const color = palette[i % palette.length];

    // Draw arc/pie segment using a filled shape approximation
    // PptxGenJS blockArc is complex — use a simple rect-based approximation
    // For production: consider rendering as image via ECharts
    // For now: use colored rectangles in a legend-style layout

    // Actually, let's render this as a legend-based value display
    // since PptxGenJS shape types for arcs are unreliable across apps
    const legendY = frame.y + 0.05 + i * 0.35;
    const legendX = frame.x + 0.1;
    const pct = Math.round((slc.value / total) * 100);

    // Color swatch
    slide.addShape("rect" as unknown as PptxGenJS.ShapeType, {
      x: legendX,
      y: legendY + 0.04,
      w: 0.18,
      h: 0.18,
      fill: { color },
      rectRadius: 0.02,
    });

    // Label + value
    slide.addText(
      [
        { text: `${truncLabel(slc.label)}  `, options: { fontSize: 10, color: tokens.ink } },
        { text: `${pct}%`, options: { fontSize: 12, bold: true, color: tokens.ink } },
        { text: `  (${formatValue(slc.value, options.unit)})`, options: { fontSize: 9, color: LABEL_GRAY } },
      ],
      {
        x: legendX + 0.25,
        y: legendY,
        w: frame.w - 0.45,
        h: 0.28,
        fontFace: tokens.bodyFont,
        valign: "middle",
      },
    );

    // Proportion bar (horizontal, simulating the donut/pie visually)
    const barW = (slc.value / total) * (frame.w - 0.5);
    slide.addShape("rect" as unknown as PptxGenJS.ShapeType, {
      x: legendX + 0.25,
      y: legendY + 0.26,
      w: barW,
      h: 0.04,
      fill: { color },
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
    slide.addShape("rect" as unknown as PptxGenJS.ShapeType, {
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
