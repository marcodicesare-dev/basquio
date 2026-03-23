import { inferSourceFileKind } from "@basquio/core";

export type PersistedSourceFileKind =
  | "workbook"
  | "pptx"
  | "pdf"
  | "document"
  | "brand-tokens"
  | "unknown";

export function normalizePersistedSourceFileKind(
  requestedKind: string | null | undefined,
  fileName: string,
): PersistedSourceFileKind {
  const resolvedKind = requestedKind ?? inferSourceFileKind(fileName);

  switch (resolvedKind) {
    case "workbook":
    case "pptx":
    case "pdf":
    case "document":
    case "brand-tokens":
    case "unknown":
      return resolvedKind;
    default:
      return "unknown";
  }
}
