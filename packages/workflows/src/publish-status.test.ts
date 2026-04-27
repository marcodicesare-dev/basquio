import { describe, expect, it } from "vitest";

import { resolvePublishedDeliveryStatus } from "./publish-status";

describe("resolvePublishedDeliveryStatus", () => {
  it("treats publishable yellow artifacts as reviewed user deliveries", () => {
    expect(resolvePublishedDeliveryStatus({
      passed: true,
      tier: "yellow",
      qualityPassport: { classification: "recovery" },
    })).toBe("reviewed");
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
