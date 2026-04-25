import { describe, expect, it } from "vitest";

import {
  resolveCitationFidelityValidatorMode,
  resolveDataPrimacyValidatorMode,
  shouldRunCitationFidelityDuringGeneration,
  shouldRunDataPrimacyDuringGeneration,
} from "./validator-rollout";

describe("validator rollout defaults", () => {
  it("defaults data primacy to warn shadow mode", () => {
    expect(resolveDataPrimacyValidatorMode(undefined)).toBe("warn");
    expect(shouldRunDataPrimacyDuringGeneration("warn")).toBe(false);
    expect(shouldRunDataPrimacyDuringGeneration("block-hero")).toBe(true);
  });

  it("defaults citation fidelity to warn shadow mode", () => {
    expect(resolveCitationFidelityValidatorMode(undefined)).toBe("warn");
    expect(shouldRunCitationFidelityDuringGeneration("warn")).toBe(false);
    expect(shouldRunCitationFidelityDuringGeneration("block")).toBe(true);
  });

  it("normalizes legacy block aliases", () => {
    expect(resolveDataPrimacyValidatorMode("block")).toBe("block-hero");
    expect(resolveCitationFidelityValidatorMode("block-hero")).toBe("block");
  });
});
