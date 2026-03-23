import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const CANDIDATE_ENV_FILES = [
  path.join(process.cwd(), ".env.local"),
  path.join(process.cwd(), "apps", "web", ".env.local"),
];

export function loadBasquioScriptEnv() {
  for (const filePath of CANDIDATE_ENV_FILES) {
    if (!existsSync(filePath)) {
      continue;
    }

    const contents = readFileSync(filePath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      const key = trimmed.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      process.env[key] = stripWrappingQuotes(rawValue);
    }
  }
}

function stripWrappingQuotes(value: string) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
