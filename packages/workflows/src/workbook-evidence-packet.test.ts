import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";

import { buildWorkbookEvidencePackets } from "./workbook-evidence-packet";

describe("workbook evidence packet", () => {
  it("preserves grouped value and volume year columns as separate source totals", () => {
    const rows = [
      [null, null, null, null, null, "Value", null, null, "Volume", null, null],
      ["WORLD", "CONTINENTS", "COUNTRY", "CATEGORY", "BRAND OWNER", 2023, 2024, 2025, 2023, 2024, 2025],
      ["World", "Europe", "Italy", "COFFEE MULTI SERVE", "MASSIMO ZANETTI", 100, 110, 120, 10, 11, 12],
      ["World", "Europe", "Italy", "COFFEE SOLUBLE", "NESTLE", 200, 210, 230, 20, 21, 23],
      ["World", "Asiapac", "Japan", "COFFEE SINGLE SERVE ROAST", "LAVAZZA", 300, 330, 400, 30, 33, 40],
    ];
    const sheet = utils.aoa_to_sheet(rows);
    sheet["!merges"] = [
      { s: { r: 0, c: 5 }, e: { r: 0, c: 7 } },
      { s: { r: 0, c: 8 }, e: { r: 0, c: 10 } },
    ];
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, sheet, "Sheet1");
    const buffer = Buffer.from(write(workbook, { type: "buffer", bookType: "xlsx" }));

    const packets = buildWorkbookEvidencePackets([{
      fileName: "Estrazione SP Segafredo.xlsx",
      kind: "workbook",
      buffer,
    }]);

    expect(packets).toHaveLength(1);
    const content = packets[0]!.content;
    expect(content).toContain("Canonical columns: WORLD, CONTINENTS, COUNTRY, CATEGORY, BRAND OWNER, Value_2023, Value_2024, Value_2025, Volume_2023, Volume_2024, Volume_2025");
    expect(content).toContain("- Value: 2023=600");
    expect(content).toContain("2025=750");
    expect(content).toContain("- Volume: 2023=60");
    expect(content).toContain("2025=75");
    expect(content).toContain("- MASSIMO ZANETTI: 120");
    expect(content).toContain("Authoring guardrail");
  });

  it("does not emit packets for non-workbook files", () => {
    const packets = buildWorkbookEvidencePackets([{
      fileName: "notes.md",
      kind: "document",
      buffer: Buffer.from("# Notes"),
    }]);

    expect(packets).toEqual([]);
  });
});
