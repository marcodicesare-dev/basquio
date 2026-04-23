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
        workbookFormats: [
          {
            sheetName: "Scatter Data",
            freezePane: "B2",
            tableStyleName: "TableStyleMedium2",
            headerFillColor: "#1A6AFF",
            headerTextColor: "#FFFFFF",
            showGridLines: false,
            columns: [
              { header: "Growth", excelNumberFormat: "0.0", widthChars: 14 },
              { header: "Share", excelNumberFormat: "0.0\"%\"", widthChars: 14 },
            ],
          },
        ],
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
            presentation: {
              legendPosition: "bottom",
              categoryAxis: {
                numberFormat: "0.0",
              },
              valueAxis: {
                numberFormat: "0.0\"%\"",
              },
              dataLabelFormat: "0.0\"%\"",
              chartBackground: "#FFFFFF",
              plotBackground: "#F7F4EE",
              gridlineColor: "#D6D1C4",
              gridlineWidth: 1.25,
              workbookPresentation: {
                freezePane: "B2",
                tableStyleName: "TableStyleMedium2",
                chartPlacement: "right-panel",
                chartPanelMinWidthColumns: 9,
                chartPanelMinHeightRows: 18,
                showGridLines: false,
              },
              series: [
                {
                  label: "Share",
                  color: "#1A6AFF",
                  lineColor: "#1A6AFF",
                  markerSymbol: "circle",
                  markerSize: 8,
                },
              ],
            },
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
    const drawingEntries = Object.keys(zip.files).filter((name) => /^xl\/drawings\/drawing\d+\.xml$/.test(name));
    assert.ok(drawingEntries.length > 0, "expected at least one workbook drawing xml entry");

    const chartXml = await zip.files[chartEntries[0]]?.async("string");
    assert.ok(chartXml?.includes("scatterChart"), "expected workbook chart xml to include a scatter chart");
    assert.ok(chartXml?.includes('legendPos val="b"'), "expected workbook chart xml to set bottom legend");
    assert.ok(chartXml?.includes("<tx><v>Share</v></tx>"), "expected workbook scatter chart xml to carry the series label");
    assert.ok(chartXml?.includes('numFmt formatCode="0.0&quot;%&quot;"') || chartXml?.includes('numFmt formatCode="0.0&quot;%&quot;" sourceLinked="0"'), "expected workbook chart xml to include deterministic percent formatting");
    assert.ok(chartXml?.includes('srgbClr val="1A6AFF"'), "expected workbook chart xml to include deterministic series color");
    assert.ok(chartXml?.includes('srgbClr val="FFFFFF"'), "expected workbook chart xml to include deterministic chart background");
    assert.ok(chartXml?.includes('srgbClr val="F7F4EE"'), "expected workbook chart xml to include deterministic plot background");
    assert.ok(chartXml?.includes('srgbClr val="D6D1C4"'), "expected workbook chart xml to include deterministic gridline color");
    const drawingXml = await zip.files[drawingEntries[0]]?.async("string");
    assert.ok(drawingXml?.includes("twoCellAnchor"), "expected chart placement to reserve a right-side panel");

    const formatProbe = await execFileAsync("python3", [
      "-c",
      [
        "from openpyxl import load_workbook",
        `wb = load_workbook(r'''${outputPath}''')`,
        "print('|'.join(wb.sheetnames))",
        "ws = wb['Scatter Data']",
        "print(ws.freeze_panes)",
        "print(ws['B2'].number_format)",
        "print(ws['C2'].number_format)",
        "print(ws.sheet_view.showGridLines)",
        "print(len(ws.tables))",
      ].join("\n"),
    ]);
    const formats = formatProbe.stdout.trim().split(/\r?\n/);
    assert.equal(formats[0], "README|Scatter Data");
    assert.equal(formats[1], "B2");
    assert.equal(formats[2], "0.0");
    assert.equal(formats[3], '0.0"%"');
    assert.equal(formats[4], "False");
    assert.equal(formats[5], "1");

    process.stdout.write("native workbook scatter chart regression passed\n");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
