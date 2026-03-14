import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { utils, write } from "xlsx";

import { runGenerationRequest } from "@basquio/workflows";

async function main() {
  const outputDir = path.resolve(process.cwd(), "output", "demo-local");
  await mkdir(outputDir, { recursive: true });

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
  const citationRows = [
    { source: "Q4 category review", type: "internal", confidence: 0.92 },
    { source: "Retailer feedback log", type: "qualitative", confidence: 0.76 },
  ];
  const brandTokens = {
    colors: {
      text: { value: "#0B0C0C" },
      accent: { value: "#1A6AFF" },
      highlight: { value: "#F0CC27" },
      surface: { value: "#FFFFFF" },
    },
    typography: {
      headingFont: { value: "Aptos Display" },
      bodyFont: { value: "Aptos" },
    },
    spacing: {
      pageX: { value: 0.6 },
      pageY: { value: 0.5 },
      sectionGap: { value: 0.32 },
      blockGap: { value: 0.2 },
    },
  };

  const performanceWorkbook = utils.book_new();
  utils.book_append_sheet(performanceWorkbook, utils.json_to_sheet(summaryRows), "MonthlyPerformance");
  const performanceBuffer = Buffer.from(write(performanceWorkbook, { bookType: "xlsx", type: "buffer" }));
  await writeFile(path.join(outputDir, "01-main-fact-table.xlsx"), performanceBuffer);

  const channelWorkbook = utils.book_new();
  utils.book_append_sheet(channelWorkbook, utils.json_to_sheet(segmentRows), "ChannelMix");
  const channelBuffer = Buffer.from(write(channelWorkbook, { bookType: "xlsx", type: "buffer" }));
  await writeFile(path.join(outputDir, "02-channel-support.xlsx"), channelBuffer);

  const citationsCsv = utils.sheet_to_csv(utils.json_to_sheet(citationRows));
  const citationsBuffer = Buffer.from(citationsCsv, "utf8");
  await writeFile(path.join(outputDir, "03-citations.csv"), citationsBuffer);

  const brandBuffer = Buffer.from(JSON.stringify(brandTokens, null, 2), "utf8");
  await writeFile(path.join(outputDir, "demo-brand-tokens.json"), brandBuffer);

  const summary = await runGenerationRequest({
    jobId: "demo-local",
    organizationId: "demo-org",
    projectId: "demo-project",
    sourceFiles: [
      {
        fileName: "01-main-fact-table.xlsx",
        mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        kind: "workbook",
        base64: performanceBuffer.toString("base64"),
      },
      {
        fileName: "02-channel-support.xlsx",
        mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        kind: "workbook",
        base64: channelBuffer.toString("base64"),
      },
      {
        fileName: "03-citations.csv",
        mediaType: "text/csv",
        kind: "workbook",
        base64: citationsBuffer.toString("base64"),
      },
    ],
    styleFile: {
      fileName: "demo-brand-tokens.json",
      mediaType: "application/json",
      kind: "brand-tokens",
      base64: brandBuffer.toString("base64"),
    },
    brief: {
      businessContext: "Quarterly FMCG evidence package for first-generation validation.",
      client: "Basquio Demo Foods",
      audience: "Executive leadership",
      objective: "Explain which commercial signals matter most before the quarterly business review",
      thesis: "Revenue concentration and channel growth now matter more than topline volume alone.",
      stakes: "Leadership is deciding where to focus the next commercial push before the quarterly review.",
    },
    businessContext: "Quarterly FMCG evidence package for first-generation validation.",
    client: "Basquio Demo Foods",
    audience: "Executive leadership",
    objective: "Explain which commercial signals matter most before the quarterly business review",
    thesis: "Revenue concentration and channel growth now matter more than topline volume alone.",
    stakes: "Leadership is deciding where to focus the next commercial push before the quarterly review.",
  });

  await writeFile(path.join(outputDir, "demo-summary.json"), JSON.stringify(summary, null, 2));

  console.log(`Demo artifacts written to ${outputDir}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Demo generation failed: ${message}`);
  process.exit(1);
});
