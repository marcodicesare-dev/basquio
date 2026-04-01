#!/usr/bin/env node

/**
 * Validate blog illustration manifest and files.
 *
 * Checks:
 * - Required fields present in manifest entries
 * - No duplicate slugs
 * - Image files exist on disk
 * - Minimum file size (rejects placeholders)
 * - Alt text and caption quality
 * - Every blog post has a manifest entry
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "apps/web/src/lib/illustrations/manifest.json");
const PUBLIC_DIR = path.join(ROOT, "apps/web/public");

const REQUIRED_FIELDS = ["id", "slug", "imagePath", "width", "height", "alt", "caption"];
const MIN_FILE_SIZE = 100_000; // 100 KB
const MIN_ALT_LENGTH = 20;
const MIN_CAPTION_LENGTH = 30;

function fail(msg) {
  console.error(`  FAIL: ${msg}`);
  return false;
}

function warn(msg) {
  console.warn(`  WARN: ${msg}`);
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error("Manifest not found at", MANIFEST_PATH);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  let passed = true;
  const seenSlugs = new Set();
  const hashes = new Map();

  console.log(`Validating ${manifest.length} illustration entries...\n`);

  for (const entry of manifest) {
    console.log(`  Checking: ${entry.slug || entry.id || "(unknown)"}`);

    // Required fields
    for (const field of REQUIRED_FIELDS) {
      if (!entry[field]) {
        passed = fail(`Missing required field "${field}" in entry ${entry.id || "(unknown)"}`);
      }
    }

    // Duplicate slugs
    if (seenSlugs.has(entry.slug)) {
      passed = fail(`Duplicate slug: ${entry.slug}`);
    }
    seenSlugs.add(entry.slug);

    // Image path format
    if (entry.imagePath && !entry.imagePath.startsWith("/")) {
      passed = fail(`imagePath must start with /: ${entry.imagePath}`);
    }
    if (entry.imagePath && !entry.imagePath.match(/\.(png|webp|jpg|jpeg)$/i)) {
      passed = fail(`imagePath must end with .png, .webp, or .jpg: ${entry.imagePath}`);
    }

    // File existence and size
    if (entry.imagePath) {
      const filePath = path.join(PUBLIC_DIR, entry.imagePath);
      if (!fs.existsSync(filePath)) {
        warn(`Image file missing: ${entry.imagePath} (run pnpm generate:illustrations)`);
      } else {
        const stat = fs.statSync(filePath);
        if (stat.size < MIN_FILE_SIZE) {
          passed = fail(`Image too small (${(stat.size / 1024).toFixed(0)} KB < ${MIN_FILE_SIZE / 1024} KB): ${entry.imagePath}`);
        }

        // Duplicate content check
        const content = fs.readFileSync(filePath);
        const hash = crypto.createHash("sha256").update(content).digest("hex");
        if (hashes.has(hash)) {
          passed = fail(`Duplicate image content: ${entry.slug} matches ${hashes.get(hash)}`);
        }
        hashes.set(hash, entry.slug);
      }
    }

    // Alt text quality
    if (entry.alt && entry.alt.length < MIN_ALT_LENGTH) {
      passed = fail(`Alt text too short (${entry.alt.length} < ${MIN_ALT_LENGTH}): ${entry.slug}`);
    }

    // Caption quality
    if (entry.caption && entry.caption.length < MIN_CAPTION_LENGTH) {
      passed = fail(`Caption too short (${entry.caption.length} < ${MIN_CAPTION_LENGTH}): ${entry.slug}`);
    }

    // Dimensions
    if (entry.width < 600 || entry.height < 315) {
      passed = fail(`Dimensions too small (${entry.width}x${entry.height}): ${entry.slug}`);
    }
  }

  // Check blog posts have illustrations
  try {
    const blogPath = path.join(ROOT, "apps/web/src/content/blog.ts");
    const blogContent = fs.readFileSync(blogPath, "utf-8");
    const slugMatches = [...blogContent.matchAll(/slug:\s*"([^"]+)"/g)];
    const blogSlugs = slugMatches.map((m) => m[1]).filter((s) => s !== "slug");

    for (const slug of blogSlugs) {
      if (!seenSlugs.has(slug)) {
        warn(`Blog post "${slug}" has no illustration manifest entry`);
      }
    }
  } catch {
    warn("Could not read blog.ts to check coverage");
  }

  console.log("");
  if (passed) {
    console.log("All structural checks passed.");
  } else {
    console.error("Some checks failed. See FAIL messages above.");
    process.exit(1);
  }
}

main();
