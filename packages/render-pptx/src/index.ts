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
  pptx.layout = input.templateProfile.slideSize === "LAYOUT_STANDARD" ? "LAYOUT_STANDARD" : "LAYOUT_WIDE";
  pptx.author = "Basquio";
  pptx.company = "Basquio";
  pptx.subject = "Basquio presentation scaffold";
  pptx.title = input.deckTitle;
  pptx.theme = {
    headFontFace: input.templateProfile.fonts[0] ?? "Aptos",
    bodyFontFace: input.templateProfile.fonts[0] ?? "Aptos",
  };

  for (const slideSpec of input.slidePlan) {
    const slide = pptx.addSlide();
    slide.background = {
      color: input.templateProfile.colors[3]?.replace("#", "") ?? "F8FAFC",
    };

    slide.addText(slideSpec.title, {
      x: 0.6,
      y: 0.5,
      w: 11.2,
      h: 0.6,
      fontFace: input.templateProfile.fonts[0] ?? "Aptos",
      fontSize: 24,
      bold: true,
      color: "0F172A",
    });

    if (slideSpec.subtitle) {
      slide.addText(slideSpec.subtitle, {
        x: 0.6,
        y: 1.15,
        w: 11.2,
        h: 0.3,
        fontSize: 11,
        color: "475569",
      });
    }

    let cursorY = 1.8;
    for (const block of slideSpec.blocks) {
      if (block.kind === "chart" && block.chartId) {
        const chart = input.charts.find((candidate) => candidate.id === block.chartId);
        slide.addShape(pptx.ShapeType.rect, {
          x: 0.6,
          y: cursorY,
          w: 5.8,
          h: 2.6,
          fill: { color: "E2E8F0" },
          line: { color: "CBD5E1" },
        });
        slide.addText(
          chart
            ? `Chart placeholder for ${chart.family} (${chart.id}). Native PPT chart binding lands in the next implementation pass.`
            : `Chart placeholder for ${block.chartId}.`,
          {
            x: 0.8,
            y: cursorY + 0.4,
            w: 5.4,
            h: 1.4,
            fontSize: 12,
            color: "334155",
          },
        );
        cursorY += 2.9;
        continue;
      }

      slide.addText(block.content ?? "", {
        x: 0.6,
        y: cursorY,
        w: 11.2,
        h: 0.45,
        fontSize: block.kind === "callout" ? 15 : 13,
        bold: block.kind === "callout",
        color: block.kind === "callout" ? "1D4ED8" : "0F172A",
        breakLine: true,
      });
      cursorY += block.kind === "callout" ? 0.7 : 0.5;
    }

    if (slideSpec.speakerNotes) {
      slide.addNotes(slideSpec.speakerNotes);
    }
  }

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

  return {
    fileName: "basquio-deck.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer,
  };
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
