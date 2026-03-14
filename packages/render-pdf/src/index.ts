import { PDFDocument, PDFPage, StandardFonts, rgb, type PDFFont } from "pdf-lib";

import type { BinaryArtifact, ChartSpec, SlideSpec, TemplateProfile } from "@basquio/types";

type RenderPdfInput = {
  deckTitle: string;
  slidePlan: SlideSpec[];
  charts: ChartSpec[];
  templateProfile: TemplateProfile;
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
      main { display: grid; gap: 18px; padding: 22px; }
      section {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 22px;
        padding: 24px;
        min-height: 500px;
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
      .split { display: grid; grid-template-columns: 1.18fr 0.82fr; gap: 16px; align-items: stretch; }
      ul { margin: 0; padding-left: 18px; display: grid; gap: 8px; line-height: 1.45; }
      .chart-card { display: grid; gap: 10px; }
      .chart-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 700; }
      .chart-row { display: grid; grid-template-columns: 1fr 64px; gap: 12px; align-items: center; }
      .chart-label { font-size: 12px; color: var(--text); }
      .bar-track { background: rgba(148, 163, 184, 0.18); border-radius: 999px; height: 10px; overflow: hidden; margin-top: 6px; }
      .bar-fill { background: linear-gradient(90deg, var(--accent), var(--highlight)); height: 100%; border-radius: 999px; }
      .chart-value { text-align: right; font-size: 12px; color: var(--muted); }
      .body-copy { line-height: 1.55; }
      @page { size: 960px 540px; margin: 0; }
    </style>
  </head>
  <body>
    <main>
      ${slides
        .map((slide) => {
          const chart = charts.find((candidate) => candidate.id === slide.blocks.find((block) => block.chartId)?.chartId);
          const metrics = slide.blocks.filter((block) => block.kind === "metric");
          const lists = slide.blocks.filter((block) => block.kind === "bullet-list" || block.kind === "evidence-list");
          const bodies = slide.blocks.filter((block) => block.kind === "body" || block.kind === "callout");

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
                chart
                  ? `<div class="split">
                    <div class="panel chart-card">
                      <div class="panel-title">${escapeHtml(chart.title || "Chart")}</div>
                      ${renderHtmlChart(chart)}
                    </div>
                    <div class="grid">
                      ${bodies
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
                        .join("")}
                    </div>
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

  for (const slide of slides) {
    const page = pdf.addPage([960, 540]);
    const isCover = slide.emphasis === "cover";
    const chart = charts.find((candidate) => candidate.id === slide.blocks.find((block) => block.chartId)?.chartId);
    const textColor = hexToRgb(isCover ? "#FFFFFF" : theme.text);
    const mutedColor = hexToRgb(isCover ? "DDE7FF" : theme.mutedText);

    page.drawRectangle({
      x: 0,
      y: 0,
      width: 960,
      height: 540,
      color: hexToRgb(isCover ? theme.text : theme.background),
    });

    page.drawText(slide.eyebrow ?? deckTitle, {
      x: 48,
      y: 488,
      size: 11,
      font: titleFont,
      color: hexToRgb(isCover ? theme.highlight : theme.accent),
    });

    page.drawText(slide.title, {
      x: 48,
      y: 446,
      size: isCover ? 28 : 24,
      font: titleFont,
      color: textColor,
    });

    if (slide.subtitle) {
      page.drawText(truncate(slide.subtitle, 120), {
        x: 48,
        y: 418,
        size: 13,
        font: bodyFont,
        color: mutedColor,
      });
    }

    let cursorY = 360;
    for (const block of slide.blocks) {
      if (block.kind === "metric") {
        page.drawRectangle({
          x: 48,
          y: cursorY - 10,
          width: 180,
          height: 54,
          color: hexToRgb(theme.surface),
          borderColor: hexToRgb(theme.border),
          borderWidth: 1,
          borderOpacity: 0.3,
        });
        page.drawText(block.label ?? "", {
          x: 60,
          y: cursorY + 22,
          size: 10,
          font: bodyFont,
          color: hexToRgb(theme.mutedText),
        });
        page.drawText(block.value ?? "", {
          x: 60,
          y: cursorY,
          size: 22,
          font: titleFont,
          color: hexToRgb(theme.text),
        });
        cursorY -= 66;
        continue;
      }

      if (block.kind === "chart" && chart) {
        page.drawText(chart.title, {
          x: 48,
          y: cursorY + 28,
          size: 11,
          font: titleFont,
          color: hexToRgb(theme.mutedText),
        });
        drawPdfChart(page, chart, { x: 48, y: cursorY - 90, w: 420, h: 110 }, theme, bodyFont);
        cursorY -= 142;
        continue;
      }

      if (block.kind === "bullet-list" || block.kind === "evidence-list") {
        const lines = block.items.slice(0, 5).map((item) => `• ${item}`);
        page.drawText(lines.join("\n"), {
          x: 48,
          y: cursorY,
          size: block.kind === "evidence-list" ? 10 : 11,
          lineHeight: 15,
          font: bodyFont,
          color: textColor,
        });
        cursorY -= Math.max(54, lines.length * 18);
        continue;
      }

      page.drawText(truncate(block.content ?? "", 180), {
        x: 48,
        y: cursorY,
        size: block.kind === "callout" ? 13 : 12,
        font: block.kind === "callout" ? titleFont : bodyFont,
        color: textColor,
        lineHeight: 16,
      });
      cursorY -= block.kind === "callout" ? 30 : 22;
    }
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

function renderHtmlChart(chart: ChartSpec) {
  const maxValue = Math.max(...chart.series.flatMap((series) => series.values), 1);
  const series = chart.series[0];

  if (!series) {
    return `<div class="body-copy">Chart data unavailable.</div>`;
  }

  return chart.categories
    .map((label, index) => {
      const value = series.values[index] ?? 0;
      const width = Math.max(6, (value / maxValue) * 100);
      return `<div class="chart-row">
        <div>
          <div class="chart-label">${escapeHtml(label)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
        </div>
        <div class="chart-value">${escapeHtml(value.toFixed(1))}</div>
      </div>`;
    })
    .join("");
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
