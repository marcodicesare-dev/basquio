import { describe, expect, it } from "vitest";

import { resolvePublishedDeliveryStatus } from "./publish-status";

describe("resolvePublishedDeliveryStatus", () => {
  it("does not mark yellow recovery artifacts as reviewed", () => {
    expect(resolvePublishedDeliveryStatus({
      passed: true,
      tier: "yellow",
      qualityPassport: { classification: "recovery" },
    })).toBe("degraded");
  });

  it("marks fully green artifacts as reviewed", () => {
    expect(resolvePublishedDeliveryStatus({
      passed: true,
      tier: "green",
      qualityPassport: { classification: "silver" },
    })).toBe("reviewed");
  });

  it("keeps bronze green artifacts out of reviewed delivery", () => {
    expect(resolvePublishedDeliveryStatus({
      passed: true,
      tier: "green",
      qualityPassport: { classification: "bronze" },
    })).toBe("degraded");
  });

  it("keeps unpublishable reports degraded", () => {
    expect(resolvePublishedDeliveryStatus({
      passed: false,
      tier: "red",
      qualityPassport: { classification: "recovery" },
    })).toBe("degraded");
  });

  it("preserves legacy gold and silver behavior", () => {
    expect(resolvePublishedDeliveryStatus({
      qualityPassport: { classification: "silver" },
    })).toBe("reviewed");
  });
});
