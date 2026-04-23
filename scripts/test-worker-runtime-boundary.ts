import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCAN_ROOTS = [
  path.join(ROOT, "scripts", "worker.ts"),
  path.join(ROOT, "packages", "workflows", "src"),
];
const BANNED_PATTERNS = [
  /from\s+["'][^"']*apps\/web[^"']*["']/,
  /from\s+["'][^"']*@\/lib\/[^"']*["']/,
];

function walk(entry: string): string[] {
  const stats = statSync(entry);
  if (stats.isFile()) {
    return entry.endsWith(".ts") || entry.endsWith(".tsx") ? [entry] : [];
  }

  return readdirSync(entry, { withFileTypes: true }).flatMap((dirent) => {
    const child = path.join(entry, dirent.name);
    if (dirent.isDirectory()) {
      return walk(child);
    }
    return child.endsWith(".ts") || child.endsWith(".tsx") ? [child] : [];
  });
}

const violations: string[] = [];

for (const root of SCAN_ROOTS) {
  for (const file of walk(root)) {
    const content = readFileSync(file, "utf8");
    for (const pattern of BANNED_PATTERNS) {
      if (pattern.test(content)) {
        violations.push(path.relative(ROOT, file));
        break;
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error(
    [
      "Worker/runtime boundary regression: these files import apps/web-only modules.",
      ...violations.map((file) => `- ${file}`),
    ].join("\n"),
  );
}

console.log("Worker runtime boundary passed.");
