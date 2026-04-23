import { describe, expect, it } from "vitest";

import {
  NiqServicesCatalogNotFoundError,
  clearNiqServicesCatalogCache,
  loadNiqServicesCatalog,
  parseNiqServicesCatalog,
} from "./niq-services-catalog";

/**
 * Parser invariants for the NIQ services catalog (spec §6.12).
 *
 * Live-file test (loads docs/domain-knowledge/niq-services-catalog.md
 * via the repo cwd) guards against regressions in the shipped v1 stub;
 * synthetic tests cover edge cases that do not appear in the live
 * catalog today.
 */

describe("niq services catalog parser", () => {
  it("loads the live v1 stub and detects pending-review", async () => {
    clearNiqServicesCatalogCache();
    const catalog = await loadNiqServicesCatalog({ skipCache: true });
    expect(catalog.entries.length).toBeGreaterThanOrEqual(10);
    expect(catalog.entries.length).toBeLessThanOrEqual(30);
    expect(catalog.reviewPending).toBe(true);
    const names = catalog.entries.map((e) => e.serviceName);
    expect(names).toContain("Retail Measurement Services");
    expect(names).toContain("Consumer Panel Services");
    expect(names).toContain("Promotional Effectiveness");
    for (const entry of catalog.entries) {
      expect(entry.serviceName.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.typicalDataInputs.length).toBeGreaterThan(0);
      expect(entry.typicalAnalystQuestion.length).toBeGreaterThan(0);
      expect(entry.typicalDeliverable.length).toBeGreaterThan(0);
    }
  });

  it("flips reviewPending to false when the sentinel is removed", () => {
    const markdown = [
      "# NIQ services catalog",
      "",
      "| service_name | description | typical_data_inputs | typical_analyst_question | typical_deliverable |",
      "|---|---|---|---|---|",
      "| Retail Measurement | Foo | Bar | Baz | Qux |",
    ].join("\n");
    const parsed = parseNiqServicesCatalog(markdown);
    expect(parsed.reviewPending).toBe(false);
    expect(parsed.entries.length).toBe(1);
  });

  it("tolerates reordered columns", () => {
    const markdown = [
      "| description | service_name | typical_deliverable | typical_data_inputs | typical_analyst_question |",
      "|---|---|---|---|---|",
      "| A service description | My Service | A deliverable | Some inputs | A question? |",
    ].join("\n");
    const parsed = parseNiqServicesCatalog(markdown);
    expect(parsed.entries).toEqual([
      {
        serviceName: "My Service",
        description: "A service description",
        typicalDataInputs: "Some inputs",
        typicalAnalystQuestion: "A question?",
        typicalDeliverable: "A deliverable",
      },
    ]);
  });

  it("drops rows with the wrong cell count but keeps valid neighbours", () => {
    const markdown = [
      "| service_name | description | typical_data_inputs | typical_analyst_question | typical_deliverable |",
      "|---|---|---|---|---|",
      "| Good One | d1 | i1 | q1 | del1 |",
      "| Too Few | only three cells | here |",
      "| Good Two | d2 | i2 | q2 | del2 |",
    ].join("\n");
    const parsed = parseNiqServicesCatalog(markdown);
    expect(parsed.entries.map((e) => e.serviceName)).toEqual(["Good One", "Good Two"]);
  });

  it("returns zero entries when no table is present", () => {
    const parsed = parseNiqServicesCatalog("# title\n\nno table here\n");
    expect(parsed.entries).toEqual([]);
    expect(parsed.reviewPending).toBe(false);
  });

  it("returns zero entries when an expected column is missing", () => {
    const markdown = [
      "| service_name | description | typical_analyst_question | typical_deliverable |",
      "|---|---|---|---|",
      "| X | d | q | del |",
    ].join("\n");
    const parsed = parseNiqServicesCatalog(markdown);
    expect(parsed.entries).toEqual([]);
  });

  it("skips blank service_name rows", () => {
    const markdown = [
      "| service_name | description | typical_data_inputs | typical_analyst_question | typical_deliverable |",
      "|---|---|---|---|---|",
      "|   | d1 | i1 | q1 | del1 |",
      "| Real | d2 | i2 | q2 | del2 |",
    ].join("\n");
    const parsed = parseNiqServicesCatalog(markdown);
    expect(parsed.entries.map((e) => e.serviceName)).toEqual(["Real"]);
  });

  it("throws NiqServicesCatalogNotFoundError when the file is missing", async () => {
    clearNiqServicesCatalogCache();
    await expect(
      loadNiqServicesCatalog({
        filePath: "docs/domain-knowledge/does-not-exist-xyz.md",
        skipCache: true,
      }),
    ).rejects.toBeInstanceOf(NiqServicesCatalogNotFoundError);
  });

  it("stops at the first blank line after table rows", () => {
    const markdown = [
      "| service_name | description | typical_data_inputs | typical_analyst_question | typical_deliverable |",
      "|---|---|---|---|---|",
      "| Inside | d | i | q | del |",
      "",
      "Prose after the table should not break the parser.",
      "| Not a row | d | i | q | del |",
    ].join("\n");
    const parsed = parseNiqServicesCatalog(markdown);
    expect(parsed.entries.map((e) => e.serviceName)).toEqual(["Inside"]);
  });
});
