import { PDFDocument, StandardFonts } from "pdf-lib";

import type { BinaryArtifact, SlideSpec, TemplateProfile } from "@basquio/types";

type RenderPdfInput = {
  deckTitle: string;
  slidePlan: SlideSpec[];
  templateProfile: TemplateProfile;
};

export async function renderPdfArtifact(input: RenderPdfInput): Promise<BinaryArtifact> {
  const html = buildDeckHtml(input.slidePlan, input.templateProfile, input.deckTitle);
  const browserlessToken = process.env.BROWSERLESS_TOKEN;

  const buffer = browserlessToken
    ? await renderViaBrowserless(html, input.deckTitle)
    : await createPlaceholderPdf(input.deckTitle, input.slidePlan);

  return {
    fileName: "basquio-deck.pdf",
    mimeType: "application/pdf",
    buffer,
  };
}

export function buildDeckHtml(slides: SlideSpec[], templateProfile: TemplateProfile, deckTitle: string) {
  const accent = templateProfile.colors[1] ?? "#2563EB";
  const text = templateProfile.colors[0] ?? "#0F172A";
  const surface = templateProfile.colors[3] ?? "#F8FAFC";
  const font = templateProfile.fonts[0] ?? "Arial";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(deckTitle)}</title>
    <style>
      body { font-family: ${font}, sans-serif; margin: 0; background: ${surface}; color: ${text}; }
      main { padding: 24px; display: grid; gap: 24px; }
      section { background: white; border: 1px solid #E2E8F0; border-radius: 20px; padding: 24px; page-break-inside: avoid; }
      h1 { margin: 0 0 12px; font-size: 28px; }
      h2 { margin: 0 0 8px; font-size: 18px; color: ${accent}; }
      p { margin: 8px 0; line-height: 1.5; }
      .tag { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #DBEAFE; color: #1D4ED8; font-size: 12px; margin-bottom: 12px; }
    </style>
  </head>
  <body>
    <main>
      ${slides
        .map(
          (slide) => `<section>
            <div class="tag">${escapeHtml(slide.purpose)}</div>
            <h1>${escapeHtml(slide.title)}</h1>
            ${slide.subtitle ? `<h2>${escapeHtml(slide.subtitle)}</h2>` : ""}
            ${slide.blocks.map((block) => `<p>${escapeHtml(block.content ?? `Chart placeholder: ${block.chartId ?? "unbound"}`)}</p>`).join("")}
          </section>`,
        )
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
        format: "A4",
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

async function createPlaceholderPdf(deckTitle: string, slides: SlideSpec[]) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([842, 595]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  page.drawText(deckTitle, {
    x: 40,
    y: 545,
    size: 24,
    font,
  });

  let cursorY = 500;
  for (const slide of slides.slice(0, 5)) {
    page.drawText(`${slide.title}`, {
      x: 40,
      y: cursorY,
      size: 15,
      font,
    });
    cursorY -= 20;

    for (const block of slide.blocks.slice(0, 3)) {
      page.drawText(`- ${truncate(block.content ?? `Chart: ${block.chartId ?? "pending"}`, 88)}`, {
        x: 56,
        y: cursorY,
        size: 10,
        font,
      });
      cursorY -= 14;
    }

    cursorY -= 14;
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
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
