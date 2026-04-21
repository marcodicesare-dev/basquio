import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import ExcelJS from "exceljs";
import JSZip from "jszip";

const execFileAsync = promisify(execFile);

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "basquio-native-workbook-"));
  const inputPath = path.join(tempDir, "input.xlsx");
  const specPath = path.join(tempDir, "spec.json");
  const outputPath = path.join(tempDir, "output.xlsx");

  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Scatter Data");
    worksheet.addRow(["Brand", "Growth", "Share"]);
    worksheet.addRow(["Alpha", 5.4, 18.1]);
    worksheet.addRow(["Beta", 3.1, 12.2]);
    worksheet.addRow(["Gamma", 7.8, 9.6]);
    worksheet.addRow(["Delta", 2.5, 15.4]);
    await workbook.xlsx.writeFile(inputPath);

    await writeFile(
      specPath,
      JSON.stringify({
        charts: [
          {
            chartId: "scatter-growth-share",
            chartType: "scatter",
            title: "Growth vs Share",
            sheetName: "Scatter Data",
            selectedHeaders: ["Growth", "Share"],
            categories: ["Alpha", "Beta", "Gamma", "Delta"],
            xAxisLabel: "Growth",
            yAxisLabel: "Share",
          },
        ],
      }),
      "utf8",
    );

    await execFileAsync("python3", [
      path.resolve(process.cwd(), "scripts", "native-workbook-charts.py"),
      inputPath,
      specPath,
      outputPath,
    ]);

    const zip = await JSZip.loadAsync(await readFile(outputPath));
    const chartEntries = Object.keys(zip.files).filter((name) => /^xl\/charts\/chart\d+\.xml$/.test(name));
    assert.ok(chartEntries.length > 0, "expected at least one native Excel chart xml entry");

    const chartXml = await zip.files[chartEntries[0]]?.async("string");
    assert.ok(chartXml?.includes("scatterChart"), "expected workbook chart xml to include a scatter chart");

    process.stdout.write("native workbook scatter chart regression passed\n");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
