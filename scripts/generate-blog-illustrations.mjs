#!/usr/bin/env node

/**
 * Generate editorial illustrations for Basquio blog posts using OpenAI image generation.
 *
 * Usage:
 *   pnpm generate:illustrations                         # generate all missing
 *   pnpm generate:illustrations -- --ids=slug1,slug2    # generate specific slugs
 *   pnpm generate:illustrations -- --force              # regenerate all, even existing
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "apps/web/src/lib/illustrations/manifest.json");
const OUTPUT_DIR = path.join(ROOT, "apps/web/public/illustrations");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY environment variable");
  process.exit(1);
}

/* ── Basquio Art Direction ── */

const ART_DIRECTION = [
  "Art direction: atmospheric, dreamy editorial illustration in the style of Every.to or Rocket.new hero images.",
  "Style: soft painterly digital art with depth. Layered atmospheric perspective. NOT flat design, NOT corporate clip-art, NOT infographic. Think fine-art meets data visualization. Subtle grain or texture overlay for warmth.",
  "Color palette: warm parchment ivory #F5F1E8 as dominant light tone, deep midnight navy #0B0C0C for depth and contrast, vivid ultramarine blue #1A6AFF as the hero accent color (glows, highlights, focal elements), warm amber gold #F0CC27 used as a small directional spark or highlight, cool slate #6B7280 for midtones and shadows. The overall feeling should be warm-to-cool gradient: warm in the foreground/base, cooler blue tones in the focal subject and depth.",
  "Composition: cinematic wide aspect ratio (3:2). One clear dominant subject at 60% visual weight. Asymmetric placement. Generous atmospheric negative space (clouds, mist, soft gradients, ambient light). Maximum two supporting elements, subtly placed.",
  "The subject matter is DATA ANALYTICS AND BUSINESS INTELLIGENCE: spreadsheet grids, bar charts, line charts, pie charts, slide decks, presentation screens, data tables, flowing data streams. These should be rendered as beautiful abstract forms, not literal screenshots. Think of charts and data grids as architectural elements or natural formations.",
  "Visual mood: contemplative, premium, intelligent, the feeling of turning chaos into clarity. Like looking out over a landscape of information that has been organized into something beautiful and meaningful.",
  "Absolutely no text, no letters, no words, no numbers, no symbols, no logos, no labels, no UI chrome, no browser windows, no app mockups.",
  "No cartoon style, no flat vector, no corporate stock illustration, no glossy 3D renders.",
].join("\n");

/* ── Scene Prompts Per Slug ── */

const SCENES = {
  "complete-guide-data-to-presentation-tools-2026":
    "Dominant subject: a vast panoramic landscape where abstract data structures (grid formations, column charts rising like buildings, flowing data streams like rivers) form a terrain. In the center foreground, a luminous presentation slide floats like a portal or monolith, glowing with ultramarine blue light. The landscape on the left is raw and unstructured (scattered data points, tangled grids). The landscape on the right, beyond the portal, is organized and beautiful (clean chart formations, ordered slide sequences). The feeling is standing at the threshold between raw data chaos and structured intelligence. Atmospheric mist and warm amber light on the horizon.",

  "basquio-vs-gamma-data-analysis-vs-slide-design":
    "Dominant subject: two tall crystalline towers or pillars on opposite sides of the frame, connected by a thin bridge of light. The left tower is built from layers of abstract data grids, spreadsheet cells, and bar chart segments stacked precisely like geological strata, glowing with amber warmth from within. The right tower is built from layered presentation slides, typographic blocks, and design elements, glowing with cool ultramarine blue. Between them, the bridge represents the gap where no single tool connects both worlds. Atmospheric clouds drift between the towers. The scene is viewed from a slight distance, emphasizing the gap.",

  "automate-category-review-decks-syndicated-data":
    "Dominant subject: a grand mechanical apparatus or engine, beautifully rendered with warm metallic tones, sitting in a misty workshop space. Raw data flows into the machine from the left as abstract spreadsheet grids and tabular forms, almost like sheets of paper being fed in. From the right side of the machine, finished presentation pages and bound report documents emerge, neatly stacked and glowing with ultramarine highlights. The machine itself has visible gears, conveyor mechanisms, and processing chambers that glow amber where the transformation happens. Subtle grocery retail motifs (abstract shelf shapes, product silhouettes) woven into the input data stream. The mood is industrial craft meeting intelligence.",

  "basquio-vs-beautiful-ai-for-data-teams":
    "Dominant subject: two workbenches seen from above at a slight angle, sharing the same warm parchment surface but holding different tools. The left bench has a precision instrument set: calipers measuring data points on a grid, a magnifying lens over a spreadsheet, small precise chart forms being assembled. Everything is structured, measured, analytical. The right bench has design tools: broad brushes, color swatches, a canvas with elegantly styled slide layouts being painted. The ultramarine blue light falls on the data side. The amber light falls on the design side. They share the same table surface but the tools and approach are different. Atmospheric depth behind with soft mist.",

  "ai-for-consultants-data-analysis-to-client-decks":
    "Dominant subject: an expansive boardroom table seen in atmospheric perspective, stretching into misty depth. On the near end of the table, raw analytical materials are spread: abstract financial model grids, market sizing frameworks, competitive positioning maps, all rendered as beautiful layered paper forms with amber highlights. As the eye moves down the table toward the far end, these raw materials progressively transform into polished, organized presentation decks and bound reports, glowing with ultramarine blue. The far end of the table disappears into a luminous mist, suggesting the client meeting beyond. A single fountain pen or strategic compass rests at the transformation point.",

  "how-to-turn-excel-data-into-presentation-slides-automatically":
    "Dominant subject: a dramatic ascending pathway or staircase carved into a mountainside, viewed from the side. At the base of the mountain, scattered spreadsheet grids and data tables lie flat on the ground, raw and unprocessed. Each ascending level of the path shows a progressively more sophisticated transformation: the lowest steps show manual hand-carried data, the middle levels show mechanical conveyor systems moving chart elements, and the summit shows a luminous automated process where finished presentation slides float upward into the sky like lanterns, glowing ultramarine blue against the warm amber sunset horizon. The mountain itself is textured with abstract data patterns. The mood is aspiration and progressive automation.",

  "basquio-vs-think-cell-data-to-deck-vs-chart-formatting":
    "Dominant subject: a split scene. On the left, a master craftsperson's precision workbench seen in close detail: a single exquisite chart is being assembled with jeweler's tools, calipers, fine brushes, and a magnifying loupe. The chart is a beautiful waterfall diagram rendered as an intricate mechanical sculpture, each segment precisely fitted like watchmaking, glowing with warm amber light. On the right, a vast automated production floor stretches into atmospheric depth: raw data sheets enter at one end and emerge as complete finished presentation decks at the other, moving through luminous processing stages that glow ultramarine blue. The contrast is deliberate: handcraft precision on one side, industrial-scale automation on the other. A thin dividing line of light separates the two worlds. Atmospheric mist fills the production floor's depth.",

  /* ── Page-level accent illustrations ── */

  "page-how-it-works":
    "Dominant subject: a luminous pipeline or aqueduct structure stretching across a wide atmospheric landscape, viewed from a low angle. On the far left, raw data elements (abstract grid fragments, scattered chart pieces, floating spreadsheet cells) swirl in a gentle vortex, being drawn into the pipeline's entrance. The pipeline is a beautiful architectural form: translucent tubes and channels with visible stages of transformation, glowing amber where data enters and transitioning to ultramarine blue where it exits. At the far right, finished presentation forms emerge: clean slide shapes, bound report silhouettes, and organized chart elements floating gently upward like paper lanterns. The pipeline itself has four distinct chambers or stages, each glowing slightly differently, suggesting processing phases. Warm dawn light on the horizon. Atmospheric mist below the pipeline. The mood is elegant engineering.",

  "page-about":
    "Dominant subject: a round table seen from a slightly elevated angle, set in an atmospheric room with tall arched windows letting in warm amber light. Around the table, six empty chairs of different styles suggest different disciplines: an analyst's drafting stool, a manager's executive chair, a strategist's wingback, a buyer's practical seat, a researcher's study chair, and an engineer's modern task chair. On the table surface, scattered work materials are mid-transformation: on one side, raw data grids and spreadsheet printouts; on the other side, polished presentation pages and bound reports. A single glowing ultramarine light source hangs above the center of the table, illuminating the work. The chairs are empty but the materials show active work, suggesting a team that just stepped away. The room has depth, with bookshelves and abstract data visualizations on the walls dissolving into atmospheric shadow. The mood is collaborative intelligence, the moment before the meeting.",

  "page-compare":
    "Dominant subject: a dramatic canyon or ravine viewed from above, with two distinct plateaus on either side. The left plateau is the world of data analytics: abstract dashboard screens, pivot table structures, and chart arrays arranged like a city of information, glowing warm amber. The right plateau is the world of presentation design: polished slide layouts, typographic compositions, and styled template forms arranged in elegant stacks, glowing cool ultramarine blue. The canyon between them is deep and misty, with no bridge connecting the two worlds. In the canyon itself, a few scattered tools and fragments have fallen: incomplete attempts to cross the gap. A single beam of light cuts diagonally across the scene from upper left, suggesting that a bridge is possible but hasn't been built yet. The mood is the gap between two powerful worlds that don't speak to each other.",
};

/* ── Generation Logic ── */

async function generateImage(prompt) {
  const models = ["gpt-image-1"];
  for (const model of models) {
    try {
      console.log("  Trying model: " + model);
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + OPENAI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          size: "1536x1024",
          quality: "high",
          output_format: "png",
          background: "opaque",
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.warn("  Model " + model + " failed: " + res.status + " " + err);
        continue;
      }

      const json = await res.json();
      return Buffer.from(json.data[0].b64_json, "base64");
    } catch (err) {
      console.warn("  Model " + model + " error: " + err.message);
    }
  }
  return null;
}

function buildPrompt(slug, scene) {
  return "Create a curated editorial illustration for the Basquio blog article: " + slug + ".\n" + ART_DIRECTION + "\nTopic scene requirement: " + scene;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const idsArg = args.find((a) => a.startsWith("--ids="));
  const targetIds = idsArg ? idsArg.replace("--ids=", "").split(",") : null;

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of manifest) {
    if (targetIds && !targetIds.includes(entry.slug)) {
      skipped++;
      continue;
    }

    const outputPath = path.join(ROOT, "apps/web/public", entry.imagePath);

    if (!force && fs.existsSync(outputPath)) {
      const stat = fs.statSync(outputPath);
      if (stat.size > 100000) {
        console.log("  SKIP " + entry.slug + " (" + (stat.size / 1024).toFixed(0) + " KB exists)");
        skipped++;
        continue;
      }
    }

    const scene = SCENES[entry.slug];
    if (!scene) {
      console.warn("  WARN No scene prompt for " + entry.slug + ", skipping");
      skipped++;
      continue;
    }

    console.log("  GENERATING " + entry.slug + "...");
    const prompt = buildPrompt(entry.slug, scene);
    const imageBuffer = await generateImage(prompt);

    if (!imageBuffer) {
      console.error("  FAILED " + entry.slug);
      failed++;
      continue;
    }

    fs.writeFileSync(outputPath, imageBuffer);
    const sizeMb = (imageBuffer.length / (1024 * 1024)).toFixed(2);
    console.log("  OK " + entry.slug + " (" + sizeMb + " MB)");
    generated++;
  }

  console.log("\nDone: " + generated + " generated, " + skipped + " skipped, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
