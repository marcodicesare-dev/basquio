#!/usr/bin/env -S node --import tsx
/**
 * Fiber v1 industries-field probe (B4d).
 *
 * Purpose: the FiberPeopleSearchQuery.industries field at
 * packages/research/src/fiber-client.ts:110-116 was declared as
 * string[] based on cross-referencing Fiber-partnered tools on Day 4,
 * but the Fiber v1 docs were ambiguous on whether the real shape is
 * `industries: string[]`, `industry: string`, or an enum. This probe
 * fires a single /v1/people-search call with a known-safe industry
 * filter and reports back so the type can be pinned or corrected.
 *
 * How to run (needs a real FIBER_API_KEY):
 *
 *   FIBER_API_KEY=sk_live_... node --import tsx scripts/probe-fiber-industries.ts
 *
 * Output: a structured summary that the implementation agent reads to
 * confirm the current type matches the live API shape. If the API
 * rejects the parameter (400 / 422) with a message like "industries
 * must be a string", update the type in fiber-client.ts and re-run.
 *
 * Cost: one Fiber peopleSearch call, typically 10 credits per
 * Fiber's public pricing. Safe for a single run.
 */

import { createFiberClient } from "../packages/research/src/fiber-client";

const KEY = process.env.FIBER_API_KEY;
if (!KEY) {
  console.error(
    "probe-fiber-industries: FIBER_API_KEY is not set. Export the key or paste it inline.",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const client = createFiberClient({ apiKey: KEY! });
  console.log("[fiber-probe] firing peopleSearch with industries: ['Consumer Goods']");
  try {
    const response = await client.peopleSearch({
      keywords: "category manager",
      industries: ["Consumer Goods"],
      locationCountry: "Italy",
      limit: 3,
    });
    const summary = {
      total: response.total,
      nextPageToken: response.nextPageToken,
      chargeInfoKeys: response.chargeInfo ? Object.keys(response.chargeInfo) : [],
      resultsCount: response.results.length,
      firstResultKeys: response.results[0] ? Object.keys(response.results[0]) : [],
    };
    console.log("[fiber-probe] SUCCESS", JSON.stringify(summary, null, 2));
    if (response.results.length > 0) {
      // Print the first profile with obvious PII masked so the log is
      // checkable-in-line without leaking a real LinkedIn profile.
      const p = response.results[0];
      const masked = {
        ...p,
        fullName: p.fullName ? `${p.fullName.slice(0, 1)}***` : null,
        email: p.email ? "***@***" : null,
        linkedinUrl: p.linkedinUrl ? "https://www.linkedin.com/in/***" : null,
      };
      console.log("[fiber-probe] first profile (masked):", JSON.stringify(masked, null, 2));
    }
  } catch (err) {
    console.error("[fiber-probe] FAILED");
    console.error(err instanceof Error ? err.message : String(err));
    console.error(
      "\nIf the message mentions the 'industries' parameter, update the type at " +
        "packages/research/src/fiber-client.ts FiberPeopleSearchQuery and re-run the probe.",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[fiber-probe] unhandled error", err);
  process.exit(1);
});
