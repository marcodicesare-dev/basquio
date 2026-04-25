import { describe, expect, it } from "vitest";

import { validateDeckContract } from "./rendering-contract";

describe("validateDeckContract", () => {
  it("accepts recommendation numbers that are derivable from prior evidence", () => {
    const result = validateDeckContract([
      {
        layoutId: "cover",
        title: "Cover",
      },
      {
        layoutId: "title-chart",
        title: "3 leve identificate portano MZ da EUR357M a EUR474M: +33% calcolato su base dati 2025",
        body: "Bridge dal business attuale al potenziale totale.",
      },
      {
        layoutId: "recommendation-cards",
        title: "3 leve prioritarie per catturare EUR118M di fatturato incrementale calcolabile",
        body: "Priorita di attivazione commerciale.",
      },
    ]);

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
