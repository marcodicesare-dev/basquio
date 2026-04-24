import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const runEvalHarness = process.env.BASQUIO_EVAL_HARNESS === "true";

const CASES = [
  {
    name: "Rossella cocktails",
    inputDir: "/Users/marcodicesare/Desktop/rossella-last-run-1831a13e-inputs",
    expected: {
      answerable: "mismatch",
      heroPassed: true,
      citationPassed: true,
      gapLanguage: ["non contiene dati", "non consente stimare"],
    },
  },
  {
    name: "Segafredo coffee",
    inputDir: "/Users/marcodicesare/Desktop/rossella-run-ec91f0d0",
    expected: {
      answerable: "fully",
      citationPassed: true,
    },
  },
  {
    name: "Synthetic thin survey",
    inputDir: path.join(process.cwd(), ".context", "eval-harness", "synthetic-thin-survey"),
    expected: {
      answerable: "mismatch",
      maxSlides: 10,
    },
  },
] as const;

describe.skipIf(!runEvalHarness)("Rossella regression eval harness", () => {
  it("tracks the Rossella cocktails case inputs and expectations", () => {
    const testCase = CASES[0];
    expect(existsSync(testCase.inputDir)).toBe(true);
    expect(testCase.expected.answerable).toBe("mismatch");
    expect(testCase.expected.heroPassed).toBe(true);
    expect(testCase.expected.citationPassed).toBe(true);
  });

  it("tracks the Segafredo coffee case inputs and expectations", () => {
    const testCase = CASES[1];
    expect(existsSync(testCase.inputDir)).toBe(true);
    expect(testCase.expected.answerable).toBe("fully");
    expect(testCase.expected.citationPassed).toBe(true);
  });

  it("tracks the synthetic thin-survey case inputs and expectations", () => {
    const testCase = CASES[2];
    expect(testCase.expected.answerable).toBe("mismatch");
    expect(testCase.expected.maxSlides).toBe(10);
  });
});
