#!/usr/bin/env node

/**
 * Semantic QA for blog illustrations using OpenAI vision.
 *
 * Runs structural validation first, then sends each changed illustration
 * to GPT-4.1-mini vision for semantic evaluation.
 *
 * Usage:
 *   pnpm qa:illustrations           # QA changed illustrations only
 *   pnpm qa:illustrations -- --all  # QA all illustrations
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "apps/web/src/lib/illustrations/manifest.json");
const PUBLIC_DIR = path.join(ROOT, "apps/web/public");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const STYLE_SPEC = `Curated editorial illustration with engraving/cutout aesthetic, subtle paper grain texture, warm parchment #F5F1E8 background, ultramarine blue #1A6AFF accent, amber #F0CC27 highlight, onyx #0B0C0C ink. One dominant subject as focal point, minimal supporting elements, generous negative space. No in-image text, no fake UI mockups, no logos, no glossy 3D, no photo-realism.`;

async function qaImage(entry, imageBase64) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a visual QA judge for the Basquio blog. Evaluate editorial illustrations against the brand style spec. Return JSON only.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Evaluate this illustration for the blog article "${entry.slug}".

Expected alt text: ${entry.alt}

Style spec: ${STYLE_SPEC}

Return JSON with these fields:
- "subject_match": boolean - does the dominant subject match the article topic?
- "style_match": boolean - does it follow the editorial engraving/collage aesthetic?
- "palette_match": boolean - does it use warm parchment, ultramarine, amber, onyx?
- "has_text": boolean - does the image contain any text, letters, numbers, or symbols?
- "has_ui_mockup": boolean - does it contain UI screenshots, app mockups, or fake interfaces?
- "composition_ok": boolean - clear focal point, generous negative space, not cluttered?
- "confidence": number 0-1 - your overall confidence in the evaluation
- "notes": string - brief notes on what works and what could improve`,
            },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${imageBase64}` },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Vision API error: ${res.status} ${err}`);
  }

  const json = await res.json();
  return JSON.parse(json.choices[0].message.content);
}

function getChangedIllustrations() {
  try {
    const output = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf-8" });
    const changed = [];
    for (const line of output.split("\n")) {
      const match = line.match(/illustrations\/(.+\.png)$/);
      if (match) changed.push(match[1].replace(/\.png$/, ""));
    }
    return changed;
  } catch {
    return [];
  }
}

async function main() {
  // Run structural validation first
  console.log("Running structural validation...\n");
  try {
    execSync("node scripts/validate-blog-illustrations.mjs", { cwd: ROOT, stdio: "inherit" });
  } catch {
    console.error("\nStructural validation failed. Fix issues before running semantic QA.");
    process.exit(1);
  }

  if (!OPENAI_API_KEY) {
    console.log("\nNo OPENAI_API_KEY set. Skipping semantic QA (structural passed).");
    return;
  }

  const args = process.argv.slice(2);
  const qaAll = args.includes("--all");

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  const changedSlugs = qaAll ? manifest.map((e) => e.slug) : getChangedIllustrations();

  if (changedSlugs.length === 0) {
    console.log("\nNo changed illustrations to QA.");
    return;
  }

  console.log(`\nRunning semantic QA on ${changedSlugs.length} illustration(s)...\n`);

  let passed = 0;
  let warned = 0;
  let failed = 0;
  const results = [];

  for (const entry of manifest) {
    if (!changedSlugs.includes(entry.slug)) continue;

    const filePath = path.join(PUBLIC_DIR, entry.imagePath);
    if (!fs.existsSync(filePath)) {
      console.log(`  SKIP ${entry.slug} (file missing)`);
      continue;
    }

    console.log(`  QA ${entry.slug}...`);
    const imageBase64 = fs.readFileSync(filePath).toString("base64");

    try {
      const result = await qaImage(entry, imageBase64);
      results.push({ slug: entry.slug, ...result });

      const hardFails = [];
      if (!result.subject_match) hardFails.push("subject mismatch");
      if (result.has_text) hardFails.push("contains text");
      if (result.has_ui_mockup) hardFails.push("contains UI mockup");

      const softWarns = [];
      if (!result.style_match) softWarns.push("style mismatch");
      if (!result.palette_match) softWarns.push("palette deviation");
      if (!result.composition_ok) softWarns.push("composition issues");

      if (hardFails.length > 0) {
        console.log(`  FAIL ${entry.slug}: ${hardFails.join(", ")}`);
        if (result.notes) console.log(`        Notes: ${result.notes}`);
        failed++;
      } else if (softWarns.length > 0) {
        console.log(`  WARN ${entry.slug}: ${softWarns.join(", ")} (confidence: ${result.confidence})`);
        if (result.notes) console.log(`        Notes: ${result.notes}`);
        warned++;
      } else {
        console.log(`  PASS ${entry.slug} (confidence: ${result.confidence})`);
        passed++;
      }
    } catch (err) {
      console.error(`  ERROR ${entry.slug}: ${err.message}`);
      failed++;
    }
  }

  // Write report
  const reportDir = path.join(ROOT, "docs/qa/reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const date = new Date().toISOString().split("T")[0];
  const report = [
    `# Blog Illustration QA Report - ${date}`,
    "",
    `Passed: ${passed} | Warned: ${warned} | Failed: ${failed}`,
    "",
    ...results.map(
      (r) =>
        `## ${r.slug}\n- Subject: ${r.subject_match ? "PASS" : "FAIL"}\n- Style: ${r.style_match ? "PASS" : "WARN"}\n- Palette: ${r.palette_match ? "PASS" : "WARN"}\n- No text: ${!r.has_text ? "PASS" : "FAIL"}\n- No UI: ${!r.has_ui_mockup ? "PASS" : "FAIL"}\n- Composition: ${r.composition_ok ? "PASS" : "WARN"}\n- Confidence: ${r.confidence}\n- Notes: ${r.notes}\n`,
    ),
  ].join("\n");

  fs.writeFileSync(path.join(reportDir, `illustration-qa-${date}.md`), report);
  fs.writeFileSync(path.join(reportDir, "illustration-qa-latest.md"), report);
  console.log(`\nReport written to docs/qa/reports/illustration-qa-${date}.md`);

  console.log(`\nSummary: ${passed} passed, ${warned} warned, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
