import fs from "node:fs";
import path from "node:path";

import manifest from "./manifest.json";

export interface BlogIllustration {
  id: string;
  slug: string;
  imagePath: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
}

const illustrations = manifest as BlogIllustration[];

/** Returns illustration only if the image file exists on disk. */
export function getIllustrationBySlug(slug: string): BlogIllustration | null {
  const entry = illustrations.find((i) => i.slug === slug);
  if (!entry) return null;

  // Check file exists (server-side only, works in Next.js build + SSR)
  const publicDir = path.join(process.cwd(), "apps/web/public");
  const filePath = path.join(publicDir, entry.imagePath);

  // Also try from the web app root (when cwd is the monorepo root)
  const altPath = path.join(process.cwd(), "public", entry.imagePath);

  if (fs.existsSync(filePath) || fs.existsSync(altPath)) {
    return entry;
  }

  return null;
}

export function listIllustrations(): BlogIllustration[] {
  return illustrations;
}
