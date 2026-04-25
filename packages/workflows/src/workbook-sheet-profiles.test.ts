import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";

import { extractWorkbookSheetProfiles } from "./workbook-sheet-profiles";

function buildWorkbookBuffer(rows: unknown[][]) {
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet(rows);
  utils.book_append_sheet(workbook, sheet, "Sheet1");
  return write(workbook, { type: "buffer", bookType: "xlsx" });
}

describe("extractWorkbookSheetProfiles", () => {
  it("tolerates sparse header cells from workbook extraction", () => {
    const headerRow = [] as unknown[];
    headerRow[1] = "Value";
    headerRow[3] = "Delta";
    const dataRow = [] as unknown[];
    dataRow[0] = "Segafredo";
    dataRow[1] = 123;
    dataRow[3] = -4;

    const profiles = extractWorkbookSheetProfiles(buildWorkbookBuffer([headerRow, dataRow]));

    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.headers).toEqual(["column_1", "Value", "column_3", "Delta"]);
    expect(profiles[0]?.rows).toEqual([
      {
        column_1: "Segafredo",
        Value: 123,
        column_3: null,
        Delta: -4,
      },
    ]);
    expect(profiles[0]?.numericValues).toEqual([123, -4]);
  });

  it("keeps later populated columns even when the header row is shorter", () => {
    const profiles = extractWorkbookSheetProfiles(buildWorkbookBuffer([
      ["Brand"],
      ["Segafredo", 57.3, 17],
    ]));

    expect(profiles[0]?.headers).toEqual(["Brand", "column_2", "column_3"]);
    expect(profiles[0]?.rows[0]).toEqual({
      Brand: "Segafredo",
      column_2: 57.3,
      column_3: 17,
    });
  });
});
