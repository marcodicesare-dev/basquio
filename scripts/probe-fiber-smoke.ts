import { readFileSync } from "node:fs";
import { createFiberClient } from "../packages/research/src/fiber-client";

const t = readFileSync("apps/web/.env.local", "utf-8");
const env: Record<string, string> = {};
for (const line of t.split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
}

async function main() {
  const client = createFiberClient({ apiKey: env.FIBER_API_KEY! });

  console.log("=== 1. lookupByEmail(marcodicesare1992@gmail.com) ===");
  try {
    const r = await client.lookupByEmail("marcodicesare1992@gmail.com");
    console.log("profile found:", !!r.profile);
    if (r.profile) {
      console.log("name:", r.profile.name);
      console.log("headline:", r.profile.headline);
      console.log("company:", r.profile.current_job?.company_name);
      console.log("linkedin:", r.profile.url);
    }
    console.log("charge:", JSON.stringify(r.chargeInfo));
  } catch (e) {
    console.log("ERROR:", e instanceof Error ? e.message : e);
  }

  console.log("\n=== 2. peopleSearch(Marco Di Cesare) ===");
  try {
    const r = await client.peopleSearch({ keywords: "Marco Di Cesare Basquio", limit: 3 });
    console.log("total:", r.total, "results:", r.results.length);
    for (const p of r.results.slice(0, 3)) {
      console.log(`  - ${p.name ?? "?"} | ${p.current_job?.title ?? "?"} @ ${p.current_job?.company_name ?? "?"} | ${p.url ?? "?"}`);
    }
    console.log("charge:", JSON.stringify(r.chargeInfo));
  } catch (e) {
    console.log("ERROR:", e instanceof Error ? e.message : e);
  }
}
main();
