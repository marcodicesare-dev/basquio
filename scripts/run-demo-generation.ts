import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { utils, write } from "xlsx";

import { parseWorkbookBuffer } from "@basquio/data-ingest";
import {
  generateInsights,
  planSlides,
  planStory,
  profileDataset,
  runDeterministicAnalytics,
} from "@basquio/intelligence";
import { renderPdfArtifact } from "@basquio/render-pdf";
import { renderPptxArtifact } from "@basquio/render-pptx";
import { createSystemTemplateProfile } from "@basquio/template-engine";

async function main() {
  const outputDir = path.resolve(process.cwd(), "output", "demo-local");
  await mkdir(outputDir, { recursive: true });

  const workbook = utils.book_new();
  const summaryRows = [
    { month: "2025-10", category: "Snacks", region: "North", revenue: 124000, share: 0.18, volume: 18500 },
    { month: "2025-11", category: "Snacks", region: "North", revenue: 132000, share: 0.2, volume: 19300 },
    { month: "2025-12", category: "Snacks", region: "North", revenue: 141500, share: 0.22, volume: 20100 },
    { month: "2025-10", category: "Beverages", region: "South", revenue: 98000, share: 0.14, volume: 14400 },
    { month: "2025-11", category: "Beverages", region: "South", revenue: 105500, share: 0.16, volume: 15100 },
    { month: "2025-12", category: "Beverages", region: "South", revenue: 112800, share: 0.17, volume: 15750 },
  ];
  const segmentRows = [
    { segment: "Modern trade", yoy_growth: 0.11, margin: 0.32, contribution: 0.48 },
    { segment: "Convenience", yoy_growth: 0.19, margin: 0.27, contribution: 0.23 },
    { segment: "E-commerce", yoy_growth: 0.34, margin: 0.22, contribution: 0.09 },
    { segment: "Traditional retail", yoy_growth: -0.03, margin: 0.18, contribution: 0.2 },
  ];

  utils.book_append_sheet(workbook, utils.json_to_sheet(summaryRows), "MonthlyPerformance");
  utils.book_append_sheet(workbook, utils.json_to_sheet(segmentRows), "ChannelMix");

  const workbookBuffer = Buffer.from(write(workbook, { bookType: "xlsx", type: "buffer" }));
  await writeFile(path.join(outputDir, "demo-input.xlsx"), workbookBuffer);

  const parsed = parseWorkbookBuffer({
    datasetId: "demo-dataset",
    fileName: "demo-input.xlsx",
    buffer: workbookBuffer,
  });

  const datasetProfile = profileDataset(parsed.datasetProfile);
  const deterministicAnalysis = runDeterministicAnalytics(parsed.normalizedWorkbook);
  const insights = generateInsights({
    datasetProfile,
    analysis: deterministicAnalysis,
  });
  const story = planStory({
    datasetProfile,
    insights,
    audience: "Executive leadership",
    objective: "Explain which commercial signals matter most before the quarterly business review",
  });
  const templateProfile = createSystemTemplateProfile();
  const slidePlan = planSlides({
    story,
    insights,
    templateProfile,
  });

  const pptxArtifact = await renderPptxArtifact({
    deckTitle: "Basquio Demo Deck",
    slidePlan: slidePlan.slides,
    charts: slidePlan.charts,
    templateProfile,
  });

  const pdfArtifact = await renderPdfArtifact({
    deckTitle: "Basquio Demo Deck",
    slidePlan: slidePlan.slides,
    templateProfile,
  });

  await writeFile(path.join(outputDir, "demo-deck.pptx"), Buffer.from(pptxArtifact.buffer));
  await writeFile(path.join(outputDir, "demo-deck.pdf"), Buffer.from(pdfArtifact.buffer));
  await writeFile(
    path.join(outputDir, "demo-summary.json"),
    JSON.stringify(
      {
        datasetProfile,
        deterministicAnalysis,
        insights,
        story,
        slidePlan,
      },
      null,
      2,
    ),
  );

  console.log(`Demo artifacts written to ${outputDir}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Demo generation failed: ${message}`);
  process.exit(1);
});
