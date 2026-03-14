import PptxGenJS from "pptxgenjs";

import type { BinaryArtifact, ChartSpec, SlideSpec, TemplateProfile } from "@basquio/types";

type RenderPptxInput = {
  deckTitle: string;
  slidePlan: SlideSpec[];
  charts: ChartSpec[];
  templateProfile: TemplateProfile;
};

export async function renderPptxArtifact(input: RenderPptxInput): Promise<BinaryArtifact> {
  const pptx = new PptxGenJS();
  const theme = resolveTheme(input.templateProfile);

  pptx.layout = input.templateProfile.slideSize === "LAYOUT_STANDARD" ? "LAYOUT_STANDARD" : "LAYOUT_WIDE";
  pptx.author = "Basquio";
  pptx.company = "Basquio";
  pptx.subject = "Basquio report output";
  pptx.title = input.deckTitle;
  pptx.theme = {
    headFontFace: theme.headingFont,
    bodyFontFace: theme.bodyFont,
  };

  for (const slideSpec of input.slidePlan) {
    renderSlide(pptx, slideSpec, input.charts, theme);
  }

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

  return {
    fileName: "basquio-deck.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer,
  };
}

function renderSlide(pptx: PptxGenJS, slideSpec: SlideSpec, charts: ChartSpec[], theme: ReturnType<typeof resolveTheme>) {
  const slide = pptx.addSlide();
  const isCover = slideSpec.emphasis === "cover";
  const pageX = theme.pageX;
  const pageY = theme.pageY;
  const contentWidth = 13.333 - pageX * 2;

  slide.background = {
    color: normalizeColor(isCover ? theme.text : theme.background),
  };

  if (!isCover) {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 13.333,
      h: 0.16,
      fill: { color: normalizeColor(theme.accent) },
      line: { color: normalizeColor(theme.accent) },
    });
  } else {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 13.333,
      h: 1.15,
      fill: { color: normalizeColor(theme.accent) },
      line: { color: normalizeColor(theme.accent) },
    });
  }

  if (slideSpec.eyebrow) {
    slide.addText(slideSpec.eyebrow.toUpperCase(), {
      x: pageX,
      y: pageY,
      w: contentWidth,
      h: 0.22,
      fontFace: theme.bodyFont,
      fontSize: 9,
      bold: true,
      color: normalizeColor(isCover ? theme.highlight : theme.accent),
    });
  }

  slide.addText(slideSpec.title, {
    x: pageX,
    y: pageY + 0.38,
    w: contentWidth,
    h: isCover ? 0.9 : 0.62,
    fontFace: theme.headingFont,
    fontSize: isCover ? theme.titleSize + 8 : theme.titleSize + 2,
    bold: true,
    color: normalizeColor(isCover ? theme.surface : theme.text),
    margin: 0,
    breakLine: false,
    fit: "shrink",
  });

  if (slideSpec.subtitle) {
    slide.addText(slideSpec.subtitle, {
      x: pageX,
      y: pageY + (isCover ? 1.4 : 1.08),
      w: contentWidth,
      h: 0.55,
      fontFace: theme.bodyFont,
      fontSize: theme.bodySize + 1,
      color: normalizeColor(isCover ? theme.surface : theme.mutedText),
      margin: 0,
      breakLine: true,
      fit: "shrink",
    });
  }

  if (!isCover) {
    slide.addShape(pptx.ShapeType.line, {
      x: pageX,
      y: pageY + 1.55,
      w: contentWidth,
      h: 0,
      line: { color: normalizeColor(theme.border), width: 1 },
    });
  }

  let cursorY = isCover ? 2.15 : 1.9;
  const metricBlocks = slideSpec.blocks.filter((block) => block.kind === "metric");
  const otherBlocks = slideSpec.blocks.filter((block) => block.kind !== "metric");

  if (metricBlocks.length > 0) {
    const cardWidth = Math.min(2.45, (contentWidth - theme.blockGap * (metricBlocks.length - 1)) / metricBlocks.length);
    metricBlocks.slice(0, 4).forEach((block, index) => {
      const x = pageX + index * (cardWidth + theme.blockGap);
      slide.addShape(pptx.ShapeType.roundRect, {
        x,
        y: cursorY,
        w: cardWidth,
        h: 0.88,
        fill: { color: normalizeColor(isCover ? theme.surface : theme.surface), transparency: isCover ? 8 : 0 },
        line: { color: normalizeColor(theme.border), transparency: 18 },
      });
      slide.addText(block.label ?? "", {
        x: x + 0.14,
        y: cursorY + 0.14,
        w: cardWidth - 0.28,
        h: 0.18,
        fontFace: theme.bodyFont,
        fontSize: 8,
        bold: true,
        color: normalizeColor(theme.mutedText),
      });
      slide.addText(block.value ?? "", {
        x: x + 0.14,
        y: cursorY + 0.33,
        w: cardWidth - 0.28,
        h: 0.3,
        fontFace: theme.headingFont,
        fontSize: 20,
        bold: true,
        color: normalizeColor(theme.text),
      });
    });
    cursorY += 1.12;
  }

  const chartBlock = otherBlocks.find((block) => block.kind === "chart" && block.chartId);
  const supportingBlocks = otherBlocks.filter((block) => block !== chartBlock);

  if (chartBlock?.chartId) {
    const chart = charts.find((candidate) => candidate.id === chartBlock.chartId);

    if (chart) {
      renderChart(slide, chart, {
        x: pageX,
        y: cursorY,
        w: 6.4,
        h: 3.55,
      }, theme, pptx);
    } else {
      renderFallbackPanel(slide, {
        x: pageX,
        y: cursorY,
        w: 6.4,
        h: 3.55,
      }, "Chart data was not available for this block.", theme);
    }

    renderTextPanel(slide, supportingBlocks, {
      x: pageX + 6.7,
      y: cursorY,
      w: 5.3,
      h: 3.55,
    }, theme, isCover);
    cursorY += 3.82;
  } else {
    cursorY = renderSequentialBlocks(slide, supportingBlocks, cursorY, pageX, contentWidth, theme, isCover);
  }

  if (slideSpec.speakerNotes) {
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
  slide: PptxGenJS.Slide,
  blocks: SlideSpec["blocks"],
  frame: { x: number; y: number; w: number; h: number },
  theme: ReturnType<typeof resolveTheme>,
  isCover: boolean,
) {
  slide.addShape("roundRect", {
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    fill: { color: normalizeColor(theme.surface), transparency: isCover ? 4 : 0 },
    line: { color: normalizeColor(theme.border), transparency: 24 },
  });

  renderSequentialBlocks(slide, blocks, frame.y + 0.18, frame.x + 0.18, frame.w - 0.36, theme, false);
}

function renderChart(
  slide: PptxGenJS.Slide,
  chart: ChartSpec,
  frame: { x: number; y: number; w: number; h: number },
  theme: ReturnType<typeof resolveTheme>,
  pptx: PptxGenJS,
) {
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

  slide.addChart(type, data as any, {
    x: frame.x + 0.12,
    y: frame.y + 0.42,
    w: frame.w - 0.24,
    h: frame.h - 0.82,
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
  slide: PptxGenJS.Slide,
  frame: { x: number; y: number; w: number; h: number },
  message: string,
  theme: ReturnType<typeof resolveTheme>,
) {
  slide.addShape("roundRect", {
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    fill: { color: normalizeColor(theme.surface) },
    line: { color: normalizeColor(theme.border), transparency: 24 },
  });
  slide.addText(message, {
    x: frame.x + 0.2,
    y: frame.y + 0.4,
    w: frame.w - 0.4,
    h: 0.8,
    fontFace: theme.bodyFont,
    fontSize: theme.bodySize,
    color: normalizeColor(theme.text),
  });
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

export async function renderTemplatePreservingDeck(templatePath: string, outputDir: string) {
  const automizerModule = await import("pptx-automizer");
  const AutomizerCtor = (
    automizerModule as {
      default?: new (...args: unknown[]) => unknown;
      Automizer?: new (...args: unknown[]) => unknown;
    }
  ).Automizer ?? (automizerModule as { default?: new (...args: unknown[]) => unknown }).default;

  if (!AutomizerCtor) {
    throw new Error("pptx-automizer is installed but did not expose an Automizer constructor.");
  }

  return {
    supported: true,
    templatePath,
    outputDir,
    engine: AutomizerCtor.name || "Automizer",
  };
}
