#!/usr/bin/env tsx
/**
 * Generates scripts/data/entity-resolution-bench.json deterministically from
 * a small template list. Run once to regenerate after changing the templates.
 *
 *   pnpm exec tsx scripts/gen-entity-resolution-corpus.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type EntityTemplate = {
  id: string;
  canonical: string;
  aliases?: string[];
  // Variants that should resolve to this entity (same-entity transforms)
  variants: string[];
  // Names that look similar but refer to a different entity
  negatives?: string[];
};

// Italian CPG flavor: stakeholders, brands, retailers, categories.
const TEMPLATES: EntityTemplate[] = [
  // Stakeholders
  {
    id: "e-elena-bianchi",
    canonical: "Elena Bianchi",
    aliases: ["E. Bianchi"],
    variants: [
      "Elena Bianchi",
      "elena bianchi",
      "Elena  Bianchi",
      "Bianchi Elena",
      "E. Bianchi",
      "Elena Bianchí",
    ],
    negatives: [
      "Elena Bianco",
      "Elena Bianchini",
      "Elena Branchi",
      "Ilaria Bianchi",
      "Elena Bianca",
    ],
  },
  {
    id: "e-mario-rossi",
    canonical: "Mario Rossi",
    variants: ["Mario Rossi", "mario rossi", "M. Rossi", "Rossi Mario"],
    negatives: ["Marco Rossi", "Mario Rosso", "Mario Russo"],
  },
  {
    id: "e-giulia-neri",
    canonical: "Giulia Neri",
    variants: ["Giulia Neri", "giulia neri", "G. Neri", "Giullia Neri"],
    negatives: ["Giulia Nera", "Giulia Nieri"],
  },
  {
    id: "e-paolo-verdi",
    canonical: "Paolo Verdi",
    variants: ["Paolo Verdi", "paolo verdi", "P. Verdi", "Verdi Paolo"],
    negatives: ["Paola Verdi", "Paolo Verde"],
  },
  {
    id: "e-francesca-gallo",
    canonical: "Francesca Gallo",
    aliases: ["Fra Gallo"],
    variants: ["Francesca Gallo", "francesca gallo", "F. Gallo", "Fra Gallo"],
    negatives: ["Francesca Gallone", "Francesco Gallo"],
  },
  {
    id: "e-stefano-colombo",
    canonical: "Stefano Colombo",
    variants: ["Stefano Colombo", "stefano colombo", "S. Colombo", "Colombo Stefano"],
    negatives: ["Stefania Colombo"],
  },
  {
    id: "e-valentina-moretti",
    canonical: "Valentina Moretti",
    variants: ["Valentina Moretti", "valentina moretti", "V. Moretti"],
    negatives: ["Valeria Moretti", "Valentina Moretto"],
  },
  {
    id: "e-chiara-greco",
    canonical: "Chiara Greco",
    variants: ["Chiara Greco", "chiara greco", "C. Greco", "Greco Chiara"],
    negatives: ["Chiara Greca"],
  },
  {
    id: "e-alessandro-ricci",
    canonical: "Alessandro Ricci",
    variants: ["Alessandro Ricci", "alessandro ricci", "A. Ricci", "Ricci Alessandro"],
    negatives: ["Alessandra Ricci", "Alessio Ricci"],
  },
  {
    id: "e-luca-martini",
    canonical: "Luca Martini",
    variants: ["Luca Martini", "luca martini", "L. Martini", "Martini Luca"],
    negatives: ["Luca Martina"],
  },
  {
    id: "e-davide-esposito",
    canonical: "Davide Esposito",
    variants: ["Davide Esposito", "davide esposito", "D. Esposito"],
    negatives: ["Davide Esposto"],
  },
  {
    id: "e-paola-ferrari",
    canonical: "Paola Ferrari",
    variants: ["Paola Ferrari", "paola ferrari", "P. Ferrari"],
    negatives: ["Paolo Ferrari", "Paola Ferraro"],
  },

  // CPG brands
  {
    id: "b-mulino-bianco",
    canonical: "Mulino Bianco",
    aliases: ["MB"],
    variants: [
      "Mulino Bianco",
      "mulino bianco",
      "Mulìno Biànco",
      "Mulino-Bianco",
      "MB",
      "MULINO BIANCO",
    ],
    negatives: ["Mulino Rosso", "Mulino Nero", "Molino Bianco", "Mulino Verde", "Bianco Mulinelli"],
  },
  {
    id: "b-barilla",
    canonical: "Barilla",
    variants: [
      "Barilla",
      "barilla",
      "BARILLA",
      "Barilla Group",
      "Barilla S.p.A.",
      "Barilla Holdings",
      "Barilla Italia",
    ],
    negatives: ["Barillo", "Barilli", "Basilla", "Varilla"],
  },
  {
    id: "b-ferrero",
    canonical: "Ferrero",
    aliases: ["Ferrero International"],
    variants: ["Ferrero", "ferrero", "FERRERO", "Ferrero International"],
    negatives: ["Ferrari", "Ferrera"],
  },
  {
    id: "b-ferrero-rocher",
    canonical: "Ferrero Rocher",
    variants: ["Ferrero Rocher", "ferrero rocher", "Ferrero-Rocher"],
    negatives: ["Ferrero Kinder"],
  },
  {
    id: "b-kinder-bueno",
    canonical: "Kinder Bueno",
    variants: ["Kinder Bueno", "kinder bueno", "Kinder-Bueno"],
    negatives: ["Kinder Happy Hippo", "Kinder Cereali"],
  },
  {
    id: "b-algida",
    canonical: "Algida",
    variants: ["Algida", "algida", "ALGIDA", "Algidà"],
    negatives: ["Algica"],
  },
  {
    id: "b-galbani",
    canonical: "Galbani",
    variants: ["Galbani", "galbani", "GALBANI", "Galbani S.p.A."],
    negatives: ["Galbanini"],
  },
  {
    id: "b-parmalat",
    canonical: "Parmalat",
    variants: ["Parmalat", "parmalat", "PARMALAT"],
    negatives: ["Parmalac"],
  },
  {
    id: "b-illycaffe",
    canonical: "illycaffè",
    aliases: ["illy"],
    variants: ["illycaffè", "illy caffè", "illycaffe", "Illy Caffè", "illy"],
    negatives: ["illyply", "illycassa"],
  },
  {
    id: "b-lavazza",
    canonical: "Lavazza",
    aliases: ["Luigi Lavazza"],
    variants: ["Lavazza", "lavazza", "LAVAZZA", "Luigi Lavazza"],
    negatives: ["Lavassa"],
  },
  {
    id: "b-loacker",
    canonical: "Loacker",
    variants: ["Loacker", "loacker", "LOACKER"],
    negatives: ["Locker"],
  },
  {
    id: "b-amadori",
    canonical: "Amadori",
    aliases: ["Gruppo Amadori"],
    variants: ["Amadori", "amadori", "AMADORI", "Gruppo Amadori"],
    negatives: ["Amador", "Amarori"],
  },
  {
    id: "b-mutti",
    canonical: "Mutti",
    variants: ["Mutti", "mutti", "MUTTI", "Mutti S.p.A."],
    negatives: ["Mitti"],
  },
  {
    id: "b-cirio",
    canonical: "Cirio",
    variants: ["Cirio", "cirio", "CIRIO"],
    negatives: ["Cirò"],
  },
  {
    id: "b-alce-nero",
    canonical: "Alce Nero",
    variants: ["Alce Nero", "alce nero", "ALCE NERO", "Alce-Nero"],
    negatives: ["Alce Bianco"],
  },
  {
    id: "b-rigoni-asiago",
    canonical: "Rigoni di Asiago",
    variants: ["Rigoni di Asiago", "rigoni di asiago", "Rigoni d'Asiago", "Rigoni Asiago"],
    negatives: ["Rigoni Milano"],
  },
  {
    id: "b-granterre",
    canonical: "GranTerre",
    aliases: ["Gran Terre"],
    variants: ["GranTerre", "granterre", "Gran Terre", "GRANTERRE"],
    negatives: ["GranPrato"],
  },
  {
    id: "b-haleon",
    canonical: "Haleon",
    variants: ["Haleon", "haleon", "HALEON"],
    negatives: ["Haleos"],
  },
  {
    id: "b-montenegro",
    canonical: "Gruppo Montenegro",
    aliases: ["Montenegro"],
    variants: ["Gruppo Montenegro", "gruppo montenegro", "Montenegro", "Amaro Montenegro"],
    negatives: ["Mondenegro"],
  },
  {
    id: "b-perugina",
    canonical: "Perugina",
    variants: ["Perugina", "perugina", "PERUGINA"],
    negatives: ["Peruggina"],
  },
  {
    id: "b-orogel",
    canonical: "Orogel",
    variants: ["Orogel", "orogel", "OROGEL"],
    negatives: ["Orgel"],
  },

  // Retailers
  {
    id: "r-coop-italia",
    canonical: "Coop Italia",
    aliases: ["Coop"],
    variants: ["Coop Italia", "coop italia", "COOP ITALIA", "Coop"],
    negatives: ["Coop Germany", "Coop Deutschland"],
  },
  {
    id: "r-conad",
    canonical: "Conad",
    variants: ["Conad", "conad", "CONAD"],
    negatives: ["Conda", "Conadi"],
  },
  {
    id: "r-carrefour-italia",
    canonical: "Carrefour Italia",
    aliases: ["Carrefour IT"],
    variants: ["Carrefour Italia", "carrefour italia", "CARREFOUR ITALIA", "Carrefour IT"],
    negatives: ["Carrefour France"],
  },
  {
    id: "r-esselunga",
    canonical: "Esselunga",
    variants: ["Esselunga", "esselunga", "ESSELUNGA"],
    negatives: ["Esse Lunga", "Lessalunga"],
  },
  {
    id: "r-eurospin",
    canonical: "Eurospin",
    variants: ["Eurospin", "eurospin", "EUROSPIN"],
    negatives: ["Eurospan"],
  },
  {
    id: "r-lidl-italia",
    canonical: "Lidl Italia",
    aliases: ["Lidl IT"],
    variants: ["Lidl Italia", "lidl italia", "LIDL ITALIA"],
    negatives: ["Lidl Deutschland"],
  },

  // Categories
  {
    id: "c-snack-salati",
    canonical: "Snack Salati",
    variants: ["Snack Salati", "snack salati", "SNACK SALATI", "Snacks Salati"],
    negatives: ["Snack Dolci", "Salsasnack"],
  },
  {
    id: "c-biscotti",
    canonical: "Biscotti",
    variants: ["Biscotti", "biscotti", "BISCOTTI"],
    negatives: ["Biscottino", "Biscotteria"],
  },
  {
    id: "c-pasta",
    canonical: "Pasta",
    variants: ["Pasta", "pasta", "PASTA"],
    negatives: ["Paste", "Pastry"],
  },
  {
    id: "c-surgelati",
    canonical: "Surgelati",
    variants: ["Surgelati", "surgelati", "SURGELATI"],
    negatives: ["Surgelato"],
  },
  {
    id: "c-caffe",
    canonical: "Caffè",
    variants: ["Caffè", "caffe", "Caffe", "Cafè"],
    negatives: ["Casfè", "Caffettiera"],
  },

  // Hard cases: abbreviations + multi-token brands
  {
    id: "b-pavesi",
    canonical: "Pavesi",
    variants: ["Pavesi", "pavesi", "PAVESI", "Pavesi S.r.l."],
    negatives: ["Pavasi", "Pavese"],
  },
  {
    id: "b-motta",
    canonical: "Motta",
    variants: ["Motta", "motta", "MOTTA", "Motta S.p.A."],
    negatives: ["Motto", "Matta"],
  },

  // Stakeholders with more edge cases
  {
    id: "e-chiara-conti",
    canonical: "Chiara Conti",
    variants: ["Chiara Conti", "C. Conti", "Conti Chiara"],
    negatives: ["Chiara Conte", "Chiara Contini", "Clara Conti"],
  },
  {
    id: "e-marco-russo",
    canonical: "Marco Russo",
    variants: ["Marco Russo", "M. Russo", "Russo Marco"],
    negatives: ["Marco Rossi", "Marco Rosso", "Mario Russo", "Marta Russo"],
  },
];

function generateFixture() {
  const candidates = TEMPLATES.map((t) => ({
    id: t.id,
    canonical_name: t.canonical,
    aliases: t.aliases ?? [],
  }));

  const cases: Array<{
    query: string;
    expected_id: string | null;
    label: "same" | "different";
    note?: string;
  }> = [];

  // Positive: every variant resolves to its canonical id.
  for (const t of TEMPLATES) {
    for (const v of t.variants) {
      cases.push({
        query: v,
        expected_id: t.id,
        label: "same",
        note: `variant of ${t.canonical}`,
      });
    }
  }

  // Negative: hand-picked lookalikes that should not collide.
  for (const t of TEMPLATES) {
    for (const n of t.negatives ?? []) {
      cases.push({
        query: n,
        expected_id: null,
        label: "different",
        note: `lookalike of ${t.canonical}`,
      });
    }
  }

  // Balance: if we have too many positives/negatives, trim from the end.
  const positives = cases.filter((c) => c.label === "same");
  const negatives = cases.filter((c) => c.label === "different");
  const minCount = Math.min(positives.length, negatives.length);
  const balanced = [...positives.slice(0, minCount), ...negatives.slice(0, minCount)];

  // Shuffle deterministically
  balanced.sort((a, b) => (a.query.toLowerCase() > b.query.toLowerCase() ? 1 : -1));

  return { candidates, cases: balanced };
}

function main() {
  const fixture = generateFixture();
  const out = resolve(process.cwd(), "scripts/data/entity-resolution-bench.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(fixture, null, 2));
  console.log(
    `Wrote ${out} — ${fixture.candidates.length} candidates, ${fixture.cases.length} cases ` +
      `(${fixture.cases.filter((c) => c.label === "same").length} same, ` +
      `${fixture.cases.filter((c) => c.label === "different").length} different).`,
  );
}

main();
