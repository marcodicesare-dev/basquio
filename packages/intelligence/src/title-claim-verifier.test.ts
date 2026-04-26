import { describe, expect, it } from "vitest";

import { validateTitleClaims } from "./title-claim-verifier";

describe("validateTitleClaims", () => {
  it("accepts directly derivable growth claims from linked sheet data", () => {
    const issues = validateTitleClaims(
      {
        position: 3,
        title: "Crescita price-led: +17% valore ma -3,9% volume; prezzo a EUR15,74/kg (+22%)",
      },
      {
        name: "S02_GlobalMarket",
        headers: ["Anno", "Valore_EUR_B", "Volume_Mld_kg", "Prezzo_EUR_kg"],
        rows: [
          { Anno: "2023", Valore_EUR_B: 46.89, Volume_Mld_kg: 3.81, Prezzo_EUR_kg: 12.31 },
          { Anno: "2024", Valore_EUR_B: 49.01, Volume_Mld_kg: 3.79, Prezzo_EUR_kg: 12.94 },
          { Anno: "2025", Valore_EUR_B: 57.32, Volume_Mld_kg: 3.64, Prezzo_EUR_kg: 15.74 },
        ],
        numericValues: [46.89, 3.81, 12.31, 49.01, 3.79, 12.94, 57.32, 3.64, 15.74],
        dataSignature: "global_value_volume_2023_2025",
      },
    );

    expect(issues).toHaveLength(0);
  });

  it("accepts recommendation-style delta claims from waterfall endpoints", () => {
    const issues = validateTitleClaims(
      {
        position: 10,
        title: "3 leve identificate portano MZ da EUR357M a EUR474M: +33% calcolato su base dati 2025",
      },
      {
        name: "S09_Waterfall",
        headers: ["Label", "Valore_EUR_M", "Tipo"],
        rows: [
          { Label: "MZ 2025", Valore_EUR_M: 356.5, Tipo: "base" },
          { Label: "SS Europa (gap)", Valore_EUR_M: 71, Tipo: "opportunity" },
          { Label: "Multi Serve Eur.Centrale", Valore_EUR_M: 30, Tipo: "opportunity" },
          { Label: "SS USA (gap)", Valore_EUR_M: 17, Tipo: "opportunity" },
          { Label: "Potenziale Totale", Valore_EUR_M: 474.5, Tipo: "totale" },
        ],
        numericValues: [356.5, 71, 30, 17, 474.5],
        dataSignature: "mz_opportunity_waterfall_2025",
      },
    );

    expect(issues).toHaveLength(0);
  });

  it("accepts headline numbers repeated in visible metric cards when a summary slide has no chart sheet", () => {
    const issues = validateTitleClaims({
      position: 2,
      title: "NS leads at 55.8% share; TT erosion offsets channel wins",
      metrics: [
        { label: "Northstar share", value: "55.8%", delta: "-0.5pp vs Jan" },
      ],
    });

    expect(issues).toHaveLength(0);
  });
});
