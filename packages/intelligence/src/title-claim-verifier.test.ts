import { describe, expect, it } from "vitest";

import { validateTitleClaims } from "./title-claim-verifier";
import type { FidelitySheetInput } from "./fidelity/types";

describe("validateTitleClaims", () => {
  const trendSheet: FidelitySheetInput = {
    name: "S03_GlobalTrend",
    headers: ["Anno", "Valore_EUR_B", "Volume_Mkg"],
    rows: [
      { Anno: 2023, Valore_EUR_B: 46.9, Volume_Mkg: 3810 },
      { Anno: 2024, Valore_EUR_B: 49.0, Volume_Mkg: 3788 },
      { Anno: 2025, Valore_EUR_B: 57.3, Volume_Mkg: 3642 },
    ],
    numericValues: [2023, 46.9, 3810, 2024, 49.0, 3788, 2025, 57.3, 3642],
    dataSignature: "trend",
  };

  it("accepts title numbers derived from workbook deltas and CAGR", () => {
    const violations = validateTitleClaims({
      position: 3,
      title: "Mercato +10,6% CAGR ma volume -4,4%",
      body: "Crescita di valore e volume 2023-2025.",
    }, trendSheet);

    expect(violations).toEqual([]);
  });

  it("ignores cover and roadmap structural numbers", () => {
    expect(validateTitleClaims({
      position: 1,
      title: "Mercato globale del caffè 2023-2025",
    }, undefined)).toEqual([]);

    const roadmapMessages = validateTitleClaims({
      position: 12,
      title: "Tre leve per recuperare il gap di 9pp: sequenza 2026-2027",
      pageIntent: "action plan",
    }, undefined).map((violation) => violation.message).join("\n");
    expect(roadmapMessages).not.toMatch(/2026|2027/);
  });
});
