import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Automizer from "pptx-automizer";
import PptxGenJS from "pptxgenjs";

import { renderChartSvg, selectChartRenderMode } from "@basquio/render-charts";
import type { BinaryArtifact, ChartSpec, SlideSpec, TemplateProfile } from "@basquio/types";

type RenderPptxInput = {
  deckTitle: string;
  slidePlan: SlideSpec[];
  charts: ChartSpec[];
  templateProfile: TemplateProfile;
  templateFile?: {
    fileName: string;
    base64: string;
  };
};

type Frame = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type WritableSlide = {
  addChart: PptxGenJS.Slide["addChart"];
  addImage: PptxGenJS.Slide["addImage"];
  addShape: PptxGenJS.Slide["addShape"];
  addTable?: PptxGenJS.Slide["addTable"];
  addText: PptxGenJS.Slide["addText"];
  addNotes?: PptxGenJS.Slide["addNotes"];
  background?: PptxGenJS.BackgroundProps;
};

export async function renderPptxArtifact(input: RenderPptxInput): Promise<BinaryArtifact> {
  if (input.templateFile && canPreserveTemplate(input.templateProfile)) {
    return renderTemplatePreservingArtifact(input);
  }

  return renderFreshDeckArtifact(input);
}

async function renderFreshDeckArtifact(input: RenderPptxInput): Promise<BinaryArtifact> {
  const pptx = new PptxGenJS();
  const theme = resolveTheme(input.templateProfile);
  const layoutName = definePresentationLayout(pptx, input.templateProfile);

  pptx.layout = layoutName;
  pptx.author = "Basquio";
  pptx.company = "Basquio";
  pptx.subject = "Basquio report output";
  pptx.title = input.deckTitle;
  pptx.theme = {
    headFontFace: theme.headingFont,
    bodyFontFace: theme.bodyFont,
  };

  for (const slideSpec of input.slidePlan) {
    renderSlide(pptx.addSlide(), pptx, slideSpec, input.charts, theme, input.templateProfile);
  }

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

  return {
    fileName: "basquio-deck.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer,
  };
}

function renderSlide(
  slide: WritableSlide,
  pptx: PptxGenJS,
  slideSpec: SlideSpec,
  charts: ChartSpec[],
  theme: ReturnType<typeof resolveTheme>,
  templateProfile: TemplateProfile,
  options: {
    preserveTemplate: boolean;
  } = { preserveTemplate: false },
) {
  const isCover = slideSpec.emphasis === "cover";
  const pageWidth = templateProfile.slideWidthInches || 13.333;
  const pageHeight = templateProfile.slideHeightInches || 7.5;
  const templateLayout = resolveTemplateLayout(templateProfile, slideSpec.layoutId);
  const titleFallback = {
    x: theme.pageX,
    y: theme.pageY + 0.38,
    w: pageWidth - theme.pageX * 2,
    h: isCover ? 0.9 : 0.62,
  };
  const titleFrame = resolveRegionFrame(templateLayout, ["title"], titleFallback) ?? titleFallback;
  const subtitleFrame = slideSpec.subtitle
    ? resolveRegionFrame(templateLayout, ["subtitle"], {
        x: theme.pageX,
        y: theme.pageY + (isCover ? 1.4 : 1.08),
        w: pageWidth - theme.pageX * 2,
        h: 0.55,
      }) ?? {
        x: theme.pageX,
        y: theme.pageY + (isCover ? 1.4 : 1.08),
        w: pageWidth - theme.pageX * 2,
        h: 0.55,
      }
    : null;
  const eyebrowFrame = slideSpec.eyebrow
    ? resolveRegionFrame(templateLayout, ["eyebrow"], {
        x: theme.pageX,
        y: theme.pageY,
        w: pageWidth - theme.pageX * 2,
        h: 0.22,
      }) ?? {
        x: theme.pageX,
        y: theme.pageY,
        w: pageWidth - theme.pageX * 2,
        h: 0.22,
      }
    : null;

  if (!options.preserveTemplate && "background" in slide) {
    slide.background = {
      color: normalizeColor(isCover ? theme.text : theme.background),
    };
  }

  if (!options.preserveTemplate && !isCover) {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: pageWidth,
      h: 0.16,
      fill: { color: normalizeColor(theme.accent) },
      line: { color: normalizeColor(theme.accent) },
    });
  } else if (!options.preserveTemplate) {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: pageWidth,
      h: 1.15,
      fill: { color: normalizeColor(theme.accent) },
      line: { color: normalizeColor(theme.accent) },
    });
  }

  if (slideSpec.eyebrow && eyebrowFrame) {
    slide.addText(slideSpec.eyebrow.toUpperCase(), {
      x: eyebrowFrame.x,
      y: eyebrowFrame.y,
      w: eyebrowFrame.w,
      h: eyebrowFrame.h,
      fontFace: theme.bodyFont,
      fontSize: 9,
      bold: true,
      color: normalizeColor(options.preserveTemplate ? theme.accent : isCover ? theme.highlight : theme.accent),
    });
  }

  slide.addText(slideSpec.title, {
    x: titleFrame.x,
    y: titleFrame.y,
    w: titleFrame.w,
    h: titleFrame.h,
    fontFace: theme.headingFont,
    fontSize: isCover ? theme.titleSize + 8 : theme.titleSize + 2,
    bold: true,
    color: normalizeColor(options.preserveTemplate ? theme.text : isCover ? theme.surface : theme.text),
    margin: 0,
    breakLine: false,
    fit: "shrink",
  });

  if (slideSpec.subtitle && subtitleFrame) {
    slide.addText(slideSpec.subtitle, {
      x: subtitleFrame.x,
      y: subtitleFrame.y,
      w: subtitleFrame.w,
      h: subtitleFrame.h,
      fontFace: theme.bodyFont,
      fontSize: theme.bodySize + 1,
      color: normalizeColor(options.preserveTemplate ? theme.mutedText : isCover ? theme.surface : theme.mutedText),
      margin: 0,
      breakLine: true,
      fit: "shrink",
    });
  }

  if (!options.preserveTemplate && !isCover) {
    const dividerY = Math.min(pageHeight - 0.18, titleFrame.y + titleFrame.h + 0.35);
    slide.addShape(pptx.ShapeType.line, {
      x: theme.pageX,
      y: dividerY,
      w: pageWidth - theme.pageX * 2,
      h: 0,
      line: { color: normalizeColor(theme.border), width: 1 },
    });
  }

  const metricBlocks = slideSpec.blocks.filter((block) => block.kind === "metric");
  const otherBlocks = slideSpec.blocks.filter((block) => block.kind !== "metric");
  const metricStripFrame =
    resolveBlockFrame(metricBlocks[0], null) ??
    resolveRegionFrame(templateLayout, ["metric-strip"], null);

  if (metricBlocks.length > 0 && metricStripFrame) {
    const metricFrames = splitFrameHorizontally(metricStripFrame, Math.min(metricBlocks.length, 4), theme.blockGap);
    metricBlocks.slice(0, 4).forEach((block, index) => {
      const frame = insetFrame(metricFrames[index], 0.05);
      if (!options.preserveTemplate) {
        slide.addShape(pptx.ShapeType.roundRect, {
          x: frame.x,
          y: frame.y,
          w: frame.w,
          h: frame.h,
          fill: { color: normalizeColor(theme.surface), transparency: isCover ? 8 : 0 },
          line: { color: normalizeColor(theme.border), transparency: 18 },
        });
      }
      slide.addText(block.label ?? "", {
        x: frame.x + 0.14,
        y: frame.y + 0.14,
        w: frame.w - 0.28,
        h: Math.min(0.22, frame.h * 0.28),
        fontFace: theme.bodyFont,
        fontSize: 8,
        bold: true,
        color: normalizeColor(theme.mutedText),
      });
      slide.addText(block.value ?? "", {
        x: frame.x + 0.14,
        y: frame.y + Math.min(0.36, frame.h * 0.36),
        w: frame.w - 0.28,
        h: Math.max(0.28, frame.h * 0.4),
        fontFace: theme.headingFont,
        fontSize: 20,
        bold: true,
        color: normalizeColor(theme.text),
      });
    });
  } else if (metricBlocks.length > 0) {
    const fallbackMetricFrame = {
      x: theme.pageX,
      y: isCover ? 2.15 : 1.9,
      w: pageWidth - theme.pageX * 2,
      h: 0.95,
    };
    const metricFrames = splitFrameHorizontally(fallbackMetricFrame, Math.min(metricBlocks.length, 4), theme.blockGap);
    metricBlocks.slice(0, 4).forEach((block, index) => {
      const frame = insetFrame(metricFrames[index], 0.05);
      if (!options.preserveTemplate) {
        slide.addShape(pptx.ShapeType.roundRect, {
          x: frame.x,
          y: frame.y,
          w: frame.w,
          h: frame.h,
          fill: { color: normalizeColor(isCover ? theme.surface : theme.surface), transparency: isCover ? 8 : 0 },
          line: { color: normalizeColor(theme.border), transparency: 18 },
        });
      }
      slide.addText(block.label ?? "", {
        x: frame.x + 0.14,
        y: frame.y + 0.14,
        w: frame.w - 0.28,
        h: 0.18,
        fontFace: theme.bodyFont,
        fontSize: 8,
        bold: true,
        color: normalizeColor(theme.mutedText),
      });
      slide.addText(block.value ?? "", {
        x: frame.x + 0.14,
        y: frame.y + 0.33,
        w: frame.w - 0.28,
        h: 0.3,
        fontFace: theme.headingFont,
        fontSize: 20,
        bold: true,
        color: normalizeColor(theme.text),
      });
    });
  }

  const chartBlock = otherBlocks.find((block) => block.kind === "chart" && block.chartId);
  const supportingBlocks = otherBlocks.filter((block) => block !== chartBlock);
  const layoutMode = inferLayoutMode(templateLayout, slideSpec, Boolean(chartBlock));
  const fallbackBodyFallback = {
    x: theme.pageX,
    y: metricStripFrame ? metricStripFrame.y + metricStripFrame.h + 0.24 : isCover ? 2.15 : 1.9,
    w: pageWidth - theme.pageX * 2,
    h: pageHeight - (metricStripFrame ? metricStripFrame.y + metricStripFrame.h + 0.6 : 2.4),
  };
  const fallbackBodyFrame = resolveRegionFrame(templateLayout, ["body", "body-left"], fallbackBodyFallback) ?? fallbackBodyFallback;

  if (chartBlock?.chartId && layoutMode === "chart-split") {
    const chart = charts.find((candidate) => candidate.id === chartBlock.chartId);
    const chartFallback = {
      x: fallbackBodyFrame.x,
      y: fallbackBodyFrame.y,
      w: Math.min(6.4, fallbackBodyFrame.w * 0.58),
      h: Math.min(3.55, fallbackBodyFrame.h),
    };
    const chartFrame =
      resolveBlockFrame(chartBlock, chartFallback) ??
      resolveRegionFrame(templateLayout, ["chart"], chartFallback) ??
      chartFallback;
    const textFallback = {
      x: chartFrame.x + chartFrame.w + theme.blockGap,
      y: chartFrame.y,
      w: Math.max(2.6, pageWidth - (chartFrame.x + chartFrame.w + theme.blockGap + theme.pageX)),
      h: chartFrame.h,
    };
    const textFrame = resolveRegionFrame(templateLayout, ["body-right", "evidence-list", "body"], textFallback) ?? textFallback;

    if (chart) {
      renderChart(slide, chart, chartFrame, theme, pptx, options.preserveTemplate);
    } else {
      renderFallbackPanel(slide, chartFrame, "Chart data was not available for this block.", theme, options.preserveTemplate);
    }

    renderBoundTextBlocks(slide, supportingBlocks, textFrame, theme, isCover, options.preserveTemplate);
  } else if (layoutMode === "two-column") {
    const [leftFrame, rightFrame] = resolveBodyFrames(templateLayout, fallbackBodyFrame, theme.blockGap);
    const midpoint = Math.ceil(supportingBlocks.length / 2);
    renderBoundTextBlocks(slide, supportingBlocks.slice(0, midpoint), leftFrame, theme, isCover, options.preserveTemplate);
    renderBoundTextBlocks(slide, supportingBlocks.slice(midpoint), rightFrame, theme, isCover, options.preserveTemplate);
  } else {
    renderBoundTextBlocks(slide, supportingBlocks, fallbackBodyFrame, theme, isCover, options.preserveTemplate);
  }

  if (slideSpec.speakerNotes && slide.addNotes) {
    slide.addNotes(slideSpec.speakerNotes);
  }
}

function renderSequentialBlocks(
  slide: PptxGenJS.Slide,
  blocks: SlideSpec["blocks"],
  cursorY: number,
  x: number,
  width: number,
  theme: ReturnType<typeof resolveTheme>,
  isCover: boolean,
) {
  let nextY = cursorY;

  for (const block of blocks) {
    if (block.kind === "callout") {
      slide.addShape("roundRect", {
        x,
        y: nextY,
        w: width,
        h: 0.74,
        fill: { color: normalizeColor(resolveToneColor(block.tone, theme)) },
        line: { color: normalizeColor(resolveToneColor(block.tone, theme)), transparency: 40 },
      });
      slide.addText(block.content ?? "", {
        x: x + 0.18,
        y: nextY + 0.16,
        w: width - 0.36,
        h: 0.4,
        fontFace: theme.bodyFont,
        fontSize: theme.bodySize + 2,
        bold: true,
        color: normalizeColor(theme.text),
      });
      nextY += 0.92;
      continue;
    }

    if (block.kind === "bullet-list" || block.kind === "evidence-list") {
      const fillColor = block.kind === "evidence-list" ? theme.surface : isCover ? theme.surface : theme.accentMuted;
      slide.addShape("roundRect", {
        x,
        y: nextY,
        w: width,
        h: Math.min(1.5, 0.38 + block.items.length * 0.28),
        fill: { color: normalizeColor(fillColor), transparency: block.kind === "bullet-list" && isCover ? 8 : 0 },
        line: { color: normalizeColor(theme.border), transparency: 22 },
      });
      slide.addText(formatItems(block.items, block.kind === "evidence-list"), {
        x: x + 0.18,
        y: nextY + 0.14,
        w: width - 0.36,
        h: Math.min(1.25, 0.24 + block.items.length * 0.25),
        fontFace: theme.bodyFont,
        fontSize: block.kind === "evidence-list" ? theme.bodySize - 1 : theme.bodySize,
        color: normalizeColor(theme.text),
        margin: 0,
        breakLine: true,
        fit: "shrink",
      });
      nextY += Math.min(1.68, 0.54 + block.items.length * 0.28);
      continue;
    }

    if (block.kind === "divider") {
      slide.addShape("line", {
        x,
        y: nextY + 0.08,
        w: width,
        h: 0,
        line: { color: normalizeColor(theme.border), width: 1 },
      });
      nextY += 0.18;
      continue;
    }

    slide.addText(block.content ?? "", {
      x,
      y: nextY,
      w: width,
      h: 0.48,
      fontFace: theme.bodyFont,
      fontSize: block.kind === "body" ? theme.bodySize : theme.bodySize + 1,
      bold: block.kind === "title" || block.kind === "subtitle",
      color: normalizeColor(isCover ? theme.surface : theme.text),
      margin: 0,
      breakLine: true,
      fit: "shrink",
    });
    nextY += 0.56;
  }

  return nextY;
}

function renderTextPanel(
  slide: WritableSlide,
  blocks: SlideSpec["blocks"],
  frame: { x: number; y: number; w: number; h: number },
  theme: ReturnType<typeof resolveTheme>,
  isCover: boolean,
  preserveTemplate: boolean,
) {
  if (!preserveTemplate) {
    slide.addShape("roundRect", {
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
      fill: { color: normalizeColor(theme.surface), transparency: isCover ? 4 : 0 },
      line: { color: normalizeColor(theme.border), transparency: 24 },
    });
  }

  renderSequentialBlocks(
    slide as PptxGenJS.Slide,
    blocks,
    frame.y + (preserveTemplate ? 0.02 : 0.18),
    frame.x + (preserveTemplate ? 0.02 : 0.18),
    frame.w - (preserveTemplate ? 0.04 : 0.36),
    theme,
    false,
  );
}

function renderBoundTextBlocks(
  slide: WritableSlide,
  blocks: SlideSpec["blocks"],
  fallbackFrame: Frame,
  theme: ReturnType<typeof resolveTheme>,
  isCover: boolean,
  preserveTemplate: boolean,
) {
  const grouped = new Map<string, { frame: Frame; blocks: SlideSpec["blocks"] }>();
  const unbound: SlideSpec["blocks"] = [];

  for (const block of blocks) {
    const boundFrame = resolveBlockFrame(block, null);

    if (!boundFrame || block.kind === "chart" || block.kind === "metric") {
      unbound.push(block);
      continue;
    }

    const key = block.templateBinding?.regionKey ?? `${boundFrame.x}:${boundFrame.y}:${boundFrame.w}:${boundFrame.h}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.blocks.push(block);
      continue;
    }

    grouped.set(key, {
      frame: boundFrame,
      blocks: [block],
    });
  }

  if (grouped.size === 0) {
    renderTextPanel(slide, blocks, fallbackFrame, theme, isCover, preserveTemplate);
    return;
  }

  for (const group of grouped.values()) {
    renderTextPanel(slide, group.blocks, group.frame, theme, isCover, preserveTemplate);
  }

  if (unbound.length > 0) {
    renderTextPanel(slide, unbound, fallbackFrame, theme, isCover, preserveTemplate);
  }
}

function renderChart(
  slide: WritableSlide,
  chart: ChartSpec,
  frame: { x: number; y: number; w: number; h: number },
  theme: ReturnType<typeof resolveTheme>,
  pptx: PptxGenJS,
  preserveTemplate: boolean,
) {
  const renderMode = selectChartRenderMode(chart);
  if (renderMode === "echarts-svg") {
    if (!preserveTemplate) {
      slide.addShape("roundRect", {
        x: frame.x,
        y: frame.y,
        w: frame.w,
        h: frame.h,
        fill: { color: normalizeColor(theme.surface) },
        line: { color: normalizeColor(theme.border), transparency: 24 },
      });
    }
    slide.addImage({
      x: frame.x + 0.08,
      y: frame.y + 0.08,
      w: frame.w - 0.16,
      h: frame.h - 0.16,
      data: svgToDataUri(
        renderChartSvg(chart, [], Math.round(frame.w * 96), Math.round(frame.h * 96), {
          background: theme.surface,
          surface: theme.surface,
          text: theme.text,
          mutedText: theme.mutedText,
          accent: theme.accent,
          accentMuted: theme.accentMuted,
          highlight: theme.highlight,
          border: theme.border,
          headingFont: theme.headingFont,
          bodyFont: theme.bodyFont,
        }),
      ),
    });
    return;
  }

  const type =
    chart.family === "line"
      ? pptx.ChartType.line
      : chart.family === "pie"
        ? pptx.ChartType.pie
        : chart.family === "scatter"
          ? pptx.ChartType.scatter
          : pptx.ChartType.bar;
  const data = chart.series.map((series) => ({
    name: series.name,
    labels: chart.categories,
    values: series.values,
  }));

  if (!preserveTemplate) {
    slide.addShape("roundRect", {
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
      fill: { color: normalizeColor(theme.surface) },
      line: { color: normalizeColor(theme.border), transparency: 24 },
    });

    slide.addText(chart.title, {
      x: frame.x + 0.18,
      y: frame.y + 0.14,
      w: frame.w - 0.36,
      h: 0.24,
      fontFace: theme.bodyFont,
      fontSize: 9,
      bold: true,
      color: normalizeColor(theme.mutedText),
    });
  }

  slide.addChart(type, data as any, {
    x: frame.x + (preserveTemplate ? 0 : 0.12),
    y: frame.y + (preserveTemplate ? 0 : 0.42),
    w: frame.w - (preserveTemplate ? 0 : 0.24),
    h: frame.h - (preserveTemplate ? 0 : 0.82),
    catAxisLabelFontFace: theme.bodyFont,
    catAxisLabelFontSize: 9,
    valAxisLabelFontFace: theme.bodyFont,
    valAxisLabelFontSize: 9,
    valAxisColor: normalizeColor(theme.border),
    catAxisColor: normalizeColor(theme.border),
    chartColors: [normalizeColor(theme.accent), normalizeColor(theme.highlight)],
    showLegend: chart.series.length > 1,
    showTitle: false,
    showValue: false,
    showCatName: false,
    showPercent: false,
    showLabel: false,
    gridLine: { color: normalizeColor(theme.border), transparency: 55 },
    lineSize: 2,
    legendColor: normalizeColor(theme.mutedText),
    legendFontFace: theme.bodyFont,
    legendFontSize: 9,
  } as any);
}

function renderFallbackPanel(
  slide: WritableSlide,
  frame: { x: number; y: number; w: number; h: number },
  message: string,
  theme: ReturnType<typeof resolveTheme>,
  preserveTemplate: boolean,
) {
  if (!preserveTemplate) {
    slide.addShape("roundRect", {
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
      fill: { color: normalizeColor(theme.surface) },
      line: { color: normalizeColor(theme.border), transparency: 24 },
    });
  }
  slide.addText(message, {
    x: frame.x + (preserveTemplate ? 0.02 : 0.2),
    y: frame.y + (preserveTemplate ? 0.02 : 0.4),
    w: frame.w - (preserveTemplate ? 0.04 : 0.4),
    h: preserveTemplate ? frame.h - 0.04 : 0.8,
    fontFace: theme.bodyFont,
    fontSize: theme.bodySize,
    color: normalizeColor(theme.text),
  });
}

function definePresentationLayout(pptx: PptxGenJS, templateProfile: TemplateProfile) {
  const width = templateProfile.slideWidthInches || (templateProfile.slideSize === "LAYOUT_STANDARD" ? 10 : 13.333);
  const height = templateProfile.slideHeightInches || 7.5;
  const layoutName = `BASQUIO_${Math.round(width * 100)}x${Math.round(height * 100)}`;

  pptx.defineLayout({
    name: layoutName,
    width,
    height,
  });

  return layoutName;
}

function resolveTemplateLayout(templateProfile: TemplateProfile, layoutId: string) {
  return (
    templateProfile.layouts.find((layout) => layout.id === layoutId) ??
    templateProfile.layouts[0] ?? {
      id: layoutId,
      name: layoutId,
      sourceName: layoutId,
      sourceMaster: "default",
      placeholders: ["title", "body"],
      regions: [],
      notes: [],
    }
  );
}

function resolveBlockFrame(block: SlideSpec["blocks"][number] | undefined, fallback: Frame | null) {
  if (!block?.templateBinding) {
    return fallback;
  }

  return {
    x: block.templateBinding.x,
    y: block.templateBinding.y,
    w: block.templateBinding.w,
    h: block.templateBinding.h,
  };
}

function resolveRegionFrame(
  layout: TemplateProfile["layouts"][number],
  placeholders: string[],
  fallback: Frame | null,
) {
  const region =
    placeholders
      .flatMap((placeholder) =>
        layout.regions.filter((candidate) => candidate.placeholder === placeholder || candidate.key.startsWith(`${placeholder}:`)),
      )
      .sort((left, right) => (right.w * right.h) - (left.w * left.h))[0] ??
    null;

  return region ? { x: region.x, y: region.y, w: region.w, h: region.h } : fallback;
}

function resolveBodyFrames(
  layout: TemplateProfile["layouts"][number],
  fallback: Frame,
  gap: number,
): [Frame, Frame] {
  const explicit = layout.regions
    .filter((region) => region.placeholder === "body-left" || region.placeholder === "body-right")
    .sort((left, right) => left.x - right.x);

  if (explicit.length >= 2) {
    return [
      { x: explicit[0].x, y: explicit[0].y, w: explicit[0].w, h: explicit[0].h },
      { x: explicit[1].x, y: explicit[1].y, w: explicit[1].w, h: explicit[1].h },
    ];
  }

  const split = splitFrameHorizontally(fallback, 2, gap);
  return [split[0], split[1]];
}

function splitFrameHorizontally(frame: Frame, count: number, gap: number) {
  const safeCount = Math.max(1, count);
  const width = (frame.w - gap * (safeCount - 1)) / safeCount;
  return Array.from({ length: safeCount }, (_, index) => ({
    x: frame.x + index * (width + gap),
    y: frame.y,
    w: width,
    h: frame.h,
  }));
}

function insetFrame(frame: Frame, inset: number): Frame {
  return {
    x: frame.x + inset,
    y: frame.y + inset,
    w: Math.max(0.2, frame.w - inset * 2),
    h: Math.max(0.2, frame.h - inset * 2),
  };
}

function inferLayoutMode(
  layout: TemplateProfile["layouts"][number],
  slideSpec: SlideSpec,
  hasChart: boolean,
) {
  if (slideSpec.emphasis === "cover") {
    return "cover" as const;
  }

  if (
    hasChart ||
    layout.placeholders.includes("chart") ||
    layout.placeholders.includes("evidence-list") ||
    layout.id.includes("evidence")
  ) {
    return "chart-split" as const;
  }

  if (
    layout.placeholders.includes("body-left") ||
    layout.placeholders.includes("body-right") ||
    layout.id.includes("two-column")
  ) {
    return "two-column" as const;
  }

  return "sequential" as const;
}

function resolveTheme(templateProfile: TemplateProfile) {
  const brandTokens = templateProfile.brandTokens;

  return {
    text: brandTokens?.palette.text ?? templateProfile.colors[0] ?? "#0F172A",
    accent: brandTokens?.palette.accent ?? templateProfile.colors[1] ?? "#2563EB",
    highlight: brandTokens?.palette.highlight ?? templateProfile.colors[2] ?? "#F0CC27",
    background: brandTokens?.palette.background ?? templateProfile.colors[3] ?? "#F8FAFC",
    surface: brandTokens?.palette.surface ?? templateProfile.colors[4] ?? "#FFFFFF",
    border: brandTokens?.palette.border ?? templateProfile.colors[5] ?? "#CBD5E1",
    accentMuted: brandTokens?.palette.accentMuted ?? "#DBEAFE",
    mutedText: "#475569",
    headingFont: brandTokens?.typography.headingFont ?? templateProfile.fonts[0] ?? "Aptos",
    bodyFont: brandTokens?.typography.bodyFont ?? templateProfile.fonts[1] ?? templateProfile.fonts[0] ?? "Aptos",
    titleSize: brandTokens?.typography.titleSize ?? 24,
    bodySize: brandTokens?.typography.bodySize ?? 12,
    pageX: brandTokens?.spacing.pageX ?? 0.6,
    pageY: brandTokens?.spacing.pageY ?? 0.5,
    blockGap: brandTokens?.spacing.blockGap ?? 0.2,
    cardRadius: brandTokens?.spacing.cardRadius ?? 0.12,
  };
}

function resolveToneColor(
  tone: SlideSpec["blocks"][number]["tone"],
  theme: ReturnType<typeof resolveTheme>,
) {
  if (tone === "positive") {
    return theme.accentMuted;
  }

  if (tone === "caution") {
    return theme.highlight;
  }

  if (tone === "neutral") {
    return theme.surface;
  }

  return theme.accentMuted;
}

function formatItems(items: string[], dense: boolean) {
  const bullet = dense ? "•" : "•";
  return items.map((item) => `${bullet} ${item}`).join("\n");
}

function normalizeColor(value: string) {
  return value.replace("#", "").toUpperCase();
}

function svgToDataUri(svg: string) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function canPreserveTemplate(templateProfile: TemplateProfile) {
  return templateProfile.sourceType === "pptx" && templateProfile.layouts.some((layout) => layout.sourceSlideNumber);
}

async function renderTemplatePreservingArtifact(input: RenderPptxInput): Promise<BinaryArtifact> {
  const theme = resolveTheme(input.templateProfile);
  const templateBuffer = Buffer.from(input.templateFile!.base64, "base64");
  const rootTemplateBuffer = await createBlankRootTemplate(input.templateProfile, input.deckTitle);
  const workspace = await mkdtemp(path.join(tmpdir(), "basquio-pptx-"));
  const outputFileName = "basquio-deck.pptx";
  const outputPath = path.join(workspace, outputFileName);

  try {
    const automizer = new Automizer({
      outputDir: workspace,
      removeExistingSlides: true,
      autoImportSlideMasters: true,
      cleanup: false,
      cleanupPlaceholders: false,
      verbosity: 0,
    });

    automizer.loadRoot(rootTemplateBuffer);
    automizer.load(templateBuffer, "template");

    for (const slideSpec of input.slidePlan) {
      const templateSlideNumber = resolveTemplateSourceSlideNumber(input.templateProfile, slideSpec.layoutId);

      if (!templateSlideNumber) {
        return renderFreshDeckArtifact(input);
      }

      automizer.addSlide("template", templateSlideNumber, (slide) => {
        slide.modify((document) => {
          scrubImportedSlideContent(document);
        });

        slide.generate((generatedSlide, pptx) => {
          renderSlide(
            generatedSlide as unknown as WritableSlide,
            pptx,
            slideSpec,
            input.charts,
            theme,
            input.templateProfile,
            { preserveTemplate: true },
          );
        });
      });
    }

    await automizer.write(outputFileName);
    const buffer = await readFile(outputPath);

    return {
      fileName: "basquio-deck.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function createBlankRootTemplate(templateProfile: TemplateProfile, deckTitle: string) {
  const pptx = new PptxGenJS();
  const layoutName = definePresentationLayout(pptx, templateProfile);

  pptx.layout = layoutName;
  pptx.author = "Basquio";
  pptx.company = "Basquio";
  pptx.title = deckTitle;
  pptx.addSlide();

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

export async function renderTemplatePreservingDeck(templatePath: string, outputDir: string) {
  return {
    supported: true,
    templatePath,
    outputDir,
    engine: "Automizer",
  };
}

function resolveTemplateSourceSlideNumber(templateProfile: TemplateProfile, layoutId: string) {
  const exactMatch = templateProfile.layouts.find((layout) => layout.id === layoutId && layout.sourceSlideNumber);

  if (exactMatch?.sourceSlideNumber) {
    return exactMatch.sourceSlideNumber;
  }

  const chartFriendlyMatch = templateProfile.layouts.find(
    (layout) => layout.sourceSlideNumber && (layout.placeholders.includes("chart") || layout.placeholders.includes("evidence-list")),
  );

  return chartFriendlyMatch?.sourceSlideNumber ?? templateProfile.layouts.find((layout) => layout.sourceSlideNumber)?.sourceSlideNumber;
}

function scrubImportedSlideContent(document: Document) {
  clearTextNodes(document);
  removeNodes(document, "p:graphicFrame");
  removePictureNodes(document);
}

function clearTextNodes(document: Document) {
  const textNodes = Array.from(document.getElementsByTagName("a:t"));

  for (const node of textNodes) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }
}

function removeNodes(document: Document, tagName: string) {
  const nodes = Array.from(document.getElementsByTagName(tagName));

  for (const node of nodes) {
    node.parentNode?.removeChild(node);
  }
}

function removePictureNodes(document: Document) {
  const pictures = Array.from(document.getElementsByTagName("p:pic"));

  for (const picture of pictures) {
    const name = picture.getElementsByTagName("p:cNvPr")[0]?.getAttribute("name")?.toLowerCase() ?? "";

    if (name.includes("logo") || name.includes("brand") || name.includes("icon")) {
      continue;
    }

    picture.parentNode?.removeChild(picture);
  }
}
