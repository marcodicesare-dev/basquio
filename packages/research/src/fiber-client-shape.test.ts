import { describe, expect, it } from "vitest";

import type {
  FiberPeopleSearchQuery,
  FiberPeopleSearchResponse,
  FiberProfile,
} from "./fiber-client";

/**
 * B4d: shape contract for Fiber v1 types that the research fetcher
 * depends on. This test does not hit the Fiber API; it asserts the
 * TypeScript surface that packages/research/src/fetcher.ts expects.
 *
 * A drift alarm: if someone renames `industries` to `industry`, or
 * changes `string[]` to `string`, or drops `next_page_token`, this
 * test fails loudly.
 *
 * The one open runtime question is whether Fiber v1 actually accepts
 * `industries: string[]` or requires a different shape at call time.
 * scripts/probe-fiber-industries.ts resolves that with a single live
 * call, owned by Marco (keys). Until the probe confirms, the
 * TypeScript type is the canonical contract and this test pins it.
 */

describe("FiberPeopleSearchQuery shape", () => {
  it("accepts an industries string array at the TypeScript level", () => {
    const query: FiberPeopleSearchQuery = {
      keywords: "category manager",
      industries: ["Consumer Goods", "Food & Beverage"],
      locationCountry: "Italy",
      limit: 5,
    };
    expect(Array.isArray(query.industries)).toBe(true);
    expect(query.industries?.length).toBe(2);
  });

  it("accepts the fetcher's minimum required field set", () => {
    const minimal: FiberPeopleSearchQuery = { keywords: "head of insights" };
    expect(typeof minimal.keywords).toBe("string");
  });
});

describe("FiberPeopleSearchResponse shape", () => {
  it("carries output.data plus pagination and chargeInfo", () => {
    const sample: FiberPeopleSearchResponse = {
      output: {
        data: [],
        total: 0,
        next_page_token: null,
      },
      chargeInfo: null,
    };
    expect(sample.output?.data).toBeDefined();
    expect(sample.output?.next_page_token).toBeNull();
  });

  it("profile shape reflects the Fiber v1 live-API verification (2026-04-24)", () => {
    // Shape pinned by scripts/probe-fiber-industries.ts on 2026-04-24.
    // The fetcher canonically reads: url, name (or first_name +
    // last_name), email, industry_name, current_job.title,
    // current_job.company_name.
    const profile: FiberProfile = {
      url: "https://www.linkedin.com/in/maria-rossi",
      user_id: "user-1",
      entity_urn: "ACoAAA...",
      name: "Maria Rossi",
      first_name: "Maria",
      last_name: "Rossi",
      headline: "Head of Insights at Kellanova Italia",
      industry_name: "Consumer Goods",
      locality: "Milan, Italy",
      current_job: {
        company_name: "Kellanova Italia",
        title: "Head of Insights",
        is_current: true,
      },
      email: "maria@example.com",
      tags: ["decision-maker"],
    };
    expect(profile.url).toContain("linkedin.com");
    expect(profile.name).toBe("Maria Rossi");
    expect(profile.current_job?.company_name).toBe("Kellanova Italia");
    expect(profile.industry_name).toBe("Consumer Goods");
  });
});
