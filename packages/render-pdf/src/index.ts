import { PDFDocument, PDFPage, StandardFonts, rgb, type PDFFont } from "pdf-lib";

import { renderChartSvg } from "@basquio/render-charts";
import type { BinaryArtifact, ChartSpec, SlideSpec, TemplateProfile } from "@basquio/types";

type RenderPdfInput = {
  deckTitle: string;
  slidePlan: SlideSpec[];
  charts: ChartSpec[];
  templateProfile: TemplateProfile;
};

type Frame = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export async function renderPdfArtifact(input: RenderPdfInput): Promise<BinaryArtifact> {
  const html = buildDeckHtml(input.slidePlan, input.charts, input.templateProfile, input.deckTitle);
  const browserlessToken = process.env.BROWSERLESS_TOKEN;

  const buffer = browserlessToken
    ? await renderViaBrowserless(html, input.deckTitle)
    : await createFallbackPdf(input.deckTitle, input.slidePlan, input.charts, input.templateProfile);

  return {
    fileName: "basquio-deck.pdf",
    mimeType: "application/pdf",
    buffer,
  };
}

export function buildDeckHtml(
  slides: SlideSpec[],
  charts: ChartSpec[],
  templateProfile: TemplateProfile,
  deckTitle: string,
) {
  const theme = resolveTheme(templateProfile);
  const pageWidth = templateProfile.slideWidthInches || 13.333;
  const pageHeight = templateProfile.slideHeightInches || 7.5;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(deckTitle)}</title>
    <style>
      :root {
        --bg: ${theme.background};
        --surface: ${theme.surface};
        --text: ${theme.text};
        --muted: ${theme.mutedText};
        --accent: ${theme.accent};
        --accent-muted: ${theme.accentMuted};
        --highlight: ${theme.highlight};
        --border: ${theme.border};
      }
      * { box-sizing: border-box; }
      body { font-family: ${escapeHtml(theme.bodyFont)}, sans-serif; margin: 0; background: var(--bg); color: var(--text); }
      main { display: grid; gap: 18px; padding: 0.24in; }
      section {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 22px;
        padding: ${theme.pageY}in ${theme.pageX}in;
        width: ${pageWidth}in;
        min-height: ${pageHeight}in;
        page-break-after: always;
        display: grid;
        grid-template-rows: auto auto 1fr;
        gap: 16px;
      }
      section.cover {
        background: var(--text);
        color: white;
        border-color: transparent;
      }
      .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--accent); font-weight: 700; }
      .cover .eyebrow { color: var(--highlight); }
      h1 { margin: 0; font-family: ${escapeHtml(theme.headingFont)}, sans-serif; font-size: 34px; line-height: 1.08; }
      h2 { margin: 0; font-size: 16px; color: var(--muted); font-weight: 500; }
      .cover h2 { color: rgba(255,255,255,0.76); }
      .grid { display: grid; gap: 14px; }
      .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .metric {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 14px 16px;
      }
      .metric-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
      .metric-value { font-size: 28px; font-weight: 700; margin-top: 6px; }
      .cover .metric { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.12); }
      .callout, .panel {
        border-radius: 18px;
        padding: 16px 18px;
        border: 1px solid var(--border);
        background: var(--surface);
      }
      .cover .callout, .cover .panel { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.12); }
      .callout { background: var(--accent-muted); }
      .panel-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); margin-bottom: 10px; font-weight: 700; }
      .split { display: grid; gap: 16px; align-items: stretch; }
      ul { margin: 0; padding-left: 18px; display: grid; gap: 8px; line-height: 1.45; }
      .chart-card { display: grid; gap: 10px; }
      .chart-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 700; }
      .chart-row { display: grid; grid-template-columns: 1fr 64px; gap: 12px; align-items: center; }
      .chart-label { font-size: 12px; color: var(--text); }
      .bar-track { background: rgba(148, 163, 184, 0.18); border-radius: 999px; height: 10px; overflow: hidden; margin-top: 6px; }
      .bar-fill { background: linear-gradient(90deg, var(--accent), var(--highlight)); height: 100%; border-radius: 999px; }
      .chart-value { text-align: right; font-size: 12px; color: var(--muted); }
      .body-copy { line-height: 1.55; }
      .two-column-layout { display: grid; gap: 16px; }
      @page { size: ${pageWidth}in ${pageHeight}in; margin: 0; }
    </style>
  </head>
  <body>
    <main>
      ${slides
        .map((slide) => {
          const layout = resolveTemplateLayout(templateProfile, slide.layoutId);
          const layoutMode = inferLayoutMode(layout, slide, Boolean(slide.blocks.find((block) => block.chartId)));
          const chart = charts.find((candidate) => candidate.id === slide.blocks.find((block) => block.chartId)?.chartId);
          const metrics = slide.blocks.filter((block) => block.kind === "metric");
          const lists = slide.blocks.filter((block) => block.kind === "bullet-list" || block.kind === "evidence-list");
          const bodies = slide.blocks.filter((block) => block.kind === "body" || block.kind === "callout");
          const midpoint = Math.ceil((lists.length + bodies.length) / 2);
          const fallbackBodyFallback = {
            x: theme.pageX,
            y: 2.1,
            w: pageWidth - theme.pageX * 2,
            h: Math.max(3, pageHeight - 2.9),
          };
          const fallbackBodyFrame = resolveRegionFrame(layout, ["body", "body-left"], fallbackBodyFallback) ?? fallbackBodyFallback;
          const chartFallback = {
            x: fallbackBodyFrame.x,
            y: fallbackBodyFrame.y,
            w: Math.min(6.4, fallbackBodyFrame.w * 0.58),
            h: fallbackBodyFrame.h,
          };
          const chartFrame = resolveRegionFrame(layout, ["chart"], chartFallback) ?? chartFallback;
          const textFallback = {
            x: chartFrame.x + chartFrame.w + theme.blockGap,
            y: chartFrame.y,
            w: Math.max(2.4, pageWidth - (chartFrame.x + chartFrame.w + theme.blockGap + theme.pageX)),
            h: chartFrame.h,
          };
          const textFrame = resolveRegionFrame(layout, ["body-right", "evidence-list", "body"], textFallback) ?? textFallback;
          const [leftColumnFrame, rightColumnFrame] = resolveBodyFrames(layout, fallbackBodyFrame, theme.blockGap);
          const textBlocks = [
            ...bodies.map((block) => ({ type: block.kind, html: `<div class="${block.kind === "callout" ? "callout" : "panel"}">
                            <div class="body-copy">${escapeHtml(block.content ?? "")}</div>
                          </div>` })),
            ...lists.map((block) => ({ type: block.kind, html: `<div class="panel">
                          <div class="panel-title">${block.kind === "evidence-list" ? "Evidence" : "Key Points"}</div>
                          <ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                        </div>` })),
          ];

          return `<section class="${slide.emphasis === "cover" ? "cover" : ""}">
            <div>
              ${slide.eyebrow ? `<div class="eyebrow">${escapeHtml(slide.eyebrow)}</div>` : ""}
              <h1>${escapeHtml(slide.title)}</h1>
              ${slide.subtitle ? `<h2>${escapeHtml(slide.subtitle)}</h2>` : ""}
            </div>

            ${metrics.length > 0 ? `<div class="grid metrics">
              ${metrics
                .map(
                  (metric) => `<div class="metric">
                    <div class="metric-label">${escapeHtml(metric.label ?? "")}</div>
                    <div class="metric-value">${escapeHtml(metric.value ?? "")}</div>
                  </div>`,
                )
                .join("")}
            </div>` : ""}

            <div class="grid">
              ${
                chart && layoutMode === "chart-split"
                  ? `<div class="split" style="grid-template-columns:${chartFrame.w}fr ${textFrame.w}fr;">
                    <div class="panel chart-card">
                      <div class="panel-title">${escapeHtml(chart.title || "Chart")}</div>
                      ${renderHtmlChart(chart, theme)}
                    </div>
                    <div class="grid">
                      ${textBlocks.map((block) => block.html).join("")}
                    </div>
                  </div>`
                  : layoutMode === "two-column"
                    ? `<div class="two-column-layout" style="grid-template-columns:${leftColumnFrame.w}fr ${rightColumnFrame.w}fr;">
                        <div class="grid">${textBlocks.slice(0, midpoint).map((block) => block.html).join("")}</div>
                        <div class="grid">${textBlocks.slice(midpoint).map((block) => block.html).join("")}</div>
                      </div>`
                  : `${bodies
                      .map(
                        (block) => `<div class="${block.kind === "callout" ? "callout" : "panel"}">
                          <div class="body-copy">${escapeHtml(block.content ?? "")}</div>
                        </div>`,
                      )
                      .join("")}
                    ${lists
                      .map(
                        (block) => `<div class="panel">
                          <div class="panel-title">${block.kind === "evidence-list" ? "Evidence" : "Key Points"}</div>
                          <ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                        </div>`,
                      )
                      .join("")}`
              }
            </div>
          </section>`;
        })
        .join("")}
    </main>
  </body>
</html>`;
}

async function renderViaBrowserless(html: string, deckTitle: string) {
  const browserlessToken = process.env.BROWSERLESS_TOKEN;
  const browserlessUrl = process.env.BROWSERLESS_URL || "https://production-sfo.browserless.io";

  if (!browserlessToken) {
    throw new Error("BROWSERLESS_TOKEN is required for Browserless rendering.");
  }

  const response = await fetch(`${browserlessUrl}/pdf?token=${browserlessToken}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      html,
      options: {
        printBackground: true,
        preferCSSPageSize: true,
        margin: {
          top: "0",
          right: "0",
          bottom: "0",
          left: "0",
        },
      },
      gotoOptions: {
        waitUntil: "networkidle0",
        timeout: 30_000,
      },
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Browserless PDF generation failed: ${response.status} ${message}`);
  }

  const rawBytes = Buffer.from(await response.arrayBuffer());
  return postProcessPdf(rawBytes, deckTitle);
}

async function postProcessPdf(pdfBytes: Buffer, deckTitle: string) {
  const pdf = await PDFDocument.load(pdfBytes);
  pdf.setTitle(deckTitle);
  pdf.setProducer("Basquio");
  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

async function createFallbackPdf(
  deckTitle: string,
  slides: SlideSpec[],
  charts: ChartSpec[],
  templateProfile: TemplateProfile,
) {
  const pdf = await PDFDocument.create();
  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdf.embedFont(StandardFonts.Helvetica);
  const theme = resolveTheme(templateProfile);
  const pageWidth = inchesToPoints(templateProfile.slideWidthInches || 13.333);
  const pageHeight = inchesToPoints(templateProfile.slideHeightInches || 7.5);

  for (const slide of slides) {
    const page = pdf.addPage([pageWidth, pageHeight]);
    const isCover = slide.emphasis === "cover";
    const layout = resolveTemplateLayout(templateProfile, slide.layoutId);
    const layoutMode = inferLayoutMode(layout, slide, Boolean(slide.blocks.find((block) => block.chartId)));
    const chart = charts.find((candidate) => candidate.id === slide.blocks.find((block) => block.chartId)?.chartId);
    const textColor = hexToRgb(isCover ? "#FFFFFF" : theme.text);
    const mutedColor = hexToRgb(isCover ? "DDE7FF" : theme.mutedText);
    const titleFrame = toPdfFrame(resolveRegionFrame(layout, ["title"], {
      x: theme.pageX,
      y: 0.72,
      w: (templateProfile.slideWidthInches || 13.333) - theme.pageX * 2,
      h: 0.8,
    }) ?? {
      x: theme.pageX,
      y: 0.72,
      w: (templateProfile.slideWidthInches || 13.333) - theme.pageX * 2,
      h: 0.8,
    }, templateProfile);
    const subtitleFrame = slide.subtitle
      ? toPdfFrame(resolveRegionFrame(layout, ["subtitle"], {
          x: theme.pageX,
          y: 1.36,
          w: (templateProfile.slideWidthInches || 13.333) - theme.pageX * 2,
          h: 0.5,
        }) ?? {
          x: theme.pageX,
          y: 1.36,
          w: (templateProfile.slideWidthInches || 13.333) - theme.pageX * 2,
          h: 0.5,
        }, templateProfile)
      : null;
    const eyebrowFrame = slide.eyebrow
      ? toPdfFrame(resolveRegionFrame(layout, ["eyebrow"], {
          x: theme.pageX,
          y: 0.42,
          w: (templateProfile.slideWidthInches || 13.333) - theme.pageX * 2,
          h: 0.2,
        }) ?? {
          x: theme.pageX,
          y: 0.42,
          w: (templateProfile.slideWidthInches || 13.333) - theme.pageX * 2,
          h: 0.2,
        }, templateProfile)
      : null;

    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
      color: hexToRgb(isCover ? theme.text : theme.background),
    });

    page.drawText(slide.eyebrow ?? deckTitle, {
      x: eyebrowFrame?.x ?? inchesToPoints(theme.pageX),
      y: eyebrowFrame?.y ?? pageHeight - 42,
      size: 11,
      font: titleFont,
      color: hexToRgb(isCover ? theme.highlight : theme.accent),
    });

    page.drawText(slide.title, {
      x: titleFrame.x,
      y: titleFrame.y,
      size: isCover ? 28 : 24,
      font: titleFont,
      color: textColor,
      maxWidth: titleFrame.w,
    });

    if (slide.subtitle && subtitleFrame) {
      page.drawText(truncate(slide.subtitle, 120), {
        x: subtitleFrame.x,
        y: subtitleFrame.y,
        size: 13,
        font: bodyFont,
        color: mutedColor,
        maxWidth: subtitleFrame.w,
      });
    }

    const metricStripFrame = resolveRegionFrame(layout, ["metric-strip"], null);
    let cursorY = pageHeight - inchesToPoints(metricStripFrame ? metricStripFrame.y + metricStripFrame.h : 2.45);
    const bodyBlocks = slide.blocks.filter((block) => block.kind !== "metric");
    const leftColumn = layoutMode === "two-column" ? bodyBlocks.slice(0, Math.ceil(bodyBlocks.length / 2)) : bodyBlocks;
    const rightColumn = layoutMode === "two-column" ? bodyBlocks.slice(Math.ceil(bodyBlocks.length / 2)) : [];

    for (const [index, block] of slide.blocks.filter((candidate) => candidate.kind === "metric").entries()) {
      if (block.kind === "metric") {
        const metricFrame = metricStripFrame
          ? toPdfFrame(splitFrameHorizontally(metricStripFrame, Math.min(slide.blocks.filter((candidate) => candidate.kind === "metric").length, 4), theme.blockGap)[index]!, templateProfile)
          : { x: 48, y: cursorY - 10, w: 180, h: 54 };
        page.drawRectangle({
          x: metricFrame.x,
          y: metricFrame.y,
          width: metricFrame.w,
          height: metricFrame.h,
          color: hexToRgb(theme.surface),
          borderColor: hexToRgb(theme.border),
          borderWidth: 1,
          borderOpacity: 0.3,
        });
        page.drawText(block.label ?? "", {
          x: metricFrame.x + 12,
          y: metricFrame.y + metricFrame.h - 16,
          size: 10,
          font: bodyFont,
          color: hexToRgb(theme.mutedText),
          maxWidth: metricFrame.w - 20,
        });
        page.drawText(block.value ?? "", {
          x: metricFrame.x + 12,
          y: metricFrame.y + 14,
          size: 22,
          font: titleFont,
          color: hexToRgb(theme.text),
          maxWidth: metricFrame.w - 20,
        });
        continue;
      }
    }

    const fallbackBodyFallback = {
      x: theme.pageX,
      y: metricStripFrame ? metricStripFrame.y + metricStripFrame.h + 0.2 : 2.1,
      w: (templateProfile.slideWidthInches || 13.333) - theme.pageX * 2,
      h: Math.max(3.1, (templateProfile.slideHeightInches || 7.5) - (metricStripFrame ? metricStripFrame.y + metricStripFrame.h + 0.55 : 2.8)),
    };
    const fallbackBodyFrame = resolveRegionFrame(layout, ["body", "body-left"], fallbackBodyFallback) ?? fallbackBodyFallback;

    if (chart && layoutMode === "chart-split") {
      const chartFrame = toPdfFrame(resolveRegionFrame(layout, ["chart"], {
        x: fallbackBodyFrame.x,
        y: fallbackBodyFrame.y,
        w: Math.min(6.2, fallbackBodyFrame.w * 0.58),
        h: fallbackBodyFrame.h,
      }) ?? {
        x: fallbackBodyFrame.x,
        y: fallbackBodyFrame.y,
        w: Math.min(6.2, fallbackBodyFrame.w * 0.58),
        h: fallbackBodyFrame.h,
      }, templateProfile);
      const textFrame = toPdfFrame(resolveRegionFrame(layout, ["body-right", "evidence-list", "body"], {
        x: fallbackBodyFrame.x + Math.min(6.2, fallbackBodyFrame.w * 0.58) + theme.blockGap,
        y: fallbackBodyFrame.y,
        w: Math.max(2.4, fallbackBodyFrame.w - Math.min(6.2, fallbackBodyFrame.w * 0.58) - theme.blockGap),
        h: fallbackBodyFrame.h,
      }) ?? {
        x: fallbackBodyFrame.x + Math.min(6.2, fallbackBodyFrame.w * 0.58) + theme.blockGap,
        y: fallbackBodyFrame.y,
        w: Math.max(2.4, fallbackBodyFrame.w - Math.min(6.2, fallbackBodyFrame.w * 0.58) - theme.blockGap),
        h: fallbackBodyFrame.h,
      }, templateProfile);
      page.drawText(chart.title, {
        x: chartFrame.x,
        y: chartFrame.y + chartFrame.h + 14,
        size: 11,
        font: titleFont,
        color: hexToRgb(theme.mutedText),
      });
      drawPdfChart(page, chart, {
        x: chartFrame.x,
        y: chartFrame.y,
        w: chartFrame.w,
        h: chartFrame.h - 22,
      }, theme, bodyFont);
      renderPdfTextColumn(page, leftColumn.filter((block) => block.kind !== "chart"), {
        x: textFrame.x,
        y: textFrame.y + textFrame.h - 8,
        bottom: textFrame.y,
        width: textFrame.w,
      }, { titleFont, bodyFont, textColor, theme });
      continue;
    }

    const [leftBodyFrame, rightBodyFrame] = resolveBodyFrames(layout, fallbackBodyFrame, theme.blockGap);
    const leftPdfFrame = toPdfFrame(leftBodyFrame, templateProfile);
    renderPdfTextColumn(page, leftColumn, {
      x: leftPdfFrame.x,
      y: leftPdfFrame.y + leftPdfFrame.h - 8,
      bottom: leftPdfFrame.y,
      width: leftPdfFrame.w,
    }, { titleFont, bodyFont, textColor, theme });

    if (rightColumn.length > 0) {
      const rightPdfFrame = toPdfFrame(rightBodyFrame, templateProfile);
      renderPdfTextColumn(page, rightColumn, {
        x: rightPdfFrame.x,
        y: rightPdfFrame.y + rightPdfFrame.h - 8,
        bottom: rightPdfFrame.y,
        width: rightPdfFrame.w,
      }, { titleFont, bodyFont, textColor, theme });
    }
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

function renderHtmlChart(chart: ChartSpec, theme: ReturnType<typeof resolveTheme>) {
  return renderChartSvg(chart, [], 960, 540, {
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
  });
}

function drawPdfChart(
  page: PDFPage,
  chart: ChartSpec,
  frame: { x: number; y: number; w: number; h: number },
  theme: ReturnType<typeof resolveTheme>,
  bodyFont: PDFFont,
) {
  const maxValue = Math.max(...chart.series.flatMap((series) => series.values), 1);
  const series = chart.series[0];

  if (!series) {
    return;
  }

  const rowHeight = frame.h / Math.max(series.values.length, 1);

  chart.categories.slice(0, 4).forEach((category, index) => {
    const value = series.values[index] ?? 0;
    const width = (value / maxValue) * (frame.w - 120);
    const y = frame.y + frame.h - rowHeight * (index + 1);

    page.drawText(truncate(category, 24), {
      x: frame.x,
      y: y + 12,
      size: 9,
      font: bodyFont,
      color: hexToRgb(theme.text),
    });

    page.drawRectangle({
      x: frame.x + 118,
      y: y + 8,
      width: frame.w - 118,
      height: 10,
      color: rgb(0.92, 0.94, 0.97),
    });

    page.drawRectangle({
      x: frame.x + 118,
      y: y + 8,
      width,
      height: 10,
      color: hexToRgb(theme.accent),
    });

    page.drawText(value.toFixed(1), {
      x: frame.x + frame.w - 28,
      y: y + 11,
      size: 8,
      font: bodyFont,
      color: hexToRgb(theme.mutedText),
    });
  });
}

function renderPdfTextColumn(
  page: PDFPage,
  blocks: SlideSpec["blocks"],
  frame: { x: number; y: number; bottom: number; width: number },
  input: {
    titleFont: PDFFont;
    bodyFont: PDFFont;
    textColor: ReturnType<typeof hexToRgb>;
    theme: ReturnType<typeof resolveTheme>;
  },
) {
  let cursorY = frame.y;
  for (const block of blocks) {
    if (block.kind === "chart") {
      continue;
    }

    if (block.kind === "bullet-list" || block.kind === "evidence-list") {
      const lines = block.items.slice(0, 5).map((item) => `• ${item}`);
      page.drawText(lines.join("\n"), {
        x: frame.x,
        y: cursorY,
        size: block.kind === "evidence-list" ? 10 : 11,
        lineHeight: 15,
        font: input.bodyFont,
        color: input.textColor,
        maxWidth: frame.width,
      });
      cursorY -= Math.max(54, lines.length * 18);
      if (cursorY < frame.bottom) return;
      continue;
    }

    page.drawText(truncate(block.content ?? "", 180), {
      x: frame.x,
      y: cursorY,
      size: block.kind === "callout" ? 13 : 12,
      font: block.kind === "callout" ? input.titleFont : input.bodyFont,
      color: input.textColor,
      lineHeight: 16,
      maxWidth: frame.width,
    });
    cursorY -= block.kind === "callout" ? 34 : 24;
    if (cursorY < frame.bottom) return;
  }
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

function resolveBodyFrames(layout: TemplateProfile["layouts"][number], fallback: Frame, gap: number): [Frame, Frame] {
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

function inferLayoutMode(
  layout: TemplateProfile["layouts"][number],
  slide: SlideSpec,
  hasChart: boolean,
) {
  if (slide.emphasis === "cover") {
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
    headingFont: brandTokens?.typography.headingFont ?? templateProfile.fonts[0] ?? "Arial",
    bodyFont: brandTokens?.typography.bodyFont ?? templateProfile.fonts[1] ?? templateProfile.fonts[0] ?? "Arial",
    pageX: brandTokens?.spacing.pageX ?? 0.6,
    pageY: brandTokens?.spacing.pageY ?? 0.5,
    blockGap: brandTokens?.spacing.blockGap ?? 0.2,
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function hexToRgb(value: string) {
  const normalized = value.replace("#", "");
  const bigint = Number.parseInt(normalized, 16);
  return rgb(((bigint >> 16) & 255) / 255, ((bigint >> 8) & 255) / 255, (bigint & 255) / 255);
}

function inchesToPoints(value: number) {
  return value * 72;
}

function toPdfFrame(frame: Frame, templateProfile: TemplateProfile): Frame {
  const slideHeight = templateProfile.slideHeightInches || 7.5;
  return {
    x: inchesToPoints(frame.x),
    y: inchesToPoints(slideHeight - frame.y - frame.h),
    w: inchesToPoints(frame.w),
    h: inchesToPoints(frame.h),
  };
}
