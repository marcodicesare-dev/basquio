/**
 * Workspace constants.
 *
 * V1 used a single BASQUIO_TEAM_ORG_ID UUID as the shared team workspace identifier.
 * V2 promotes that UUID to a real workspaces table row (see migration
 * 20260420120000_v2_workspace_tables.sql). The same UUID now serves both paths:
 * - legacy code reading organization_id keeps working
 * - V2 code reading workspace_id sees the same value, linked to the real row
 *
 * Naming: V2 code uses BASQUIO_TEAM_WORKSPACE_ID. BASQUIO_TEAM_ORG_ID stays
 * exported as an alias for call sites we have not migrated yet.
 */

export const BASQUIO_TEAM_WORKSPACE_ID = "15cc947e-70cb-455a-b0df-d8c34b760d71";

/** @deprecated Use BASQUIO_TEAM_WORKSPACE_ID. Kept as alias during V2 migration. */
export const BASQUIO_TEAM_ORG_ID = BASQUIO_TEAM_WORKSPACE_ID;

export const KNOWLEDGE_BUCKET = "knowledge-base";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const RESUMABLE_UPLOAD_THRESHOLD_BYTES = 6 * 1024 * 1024;
export const RESUMABLE_CHUNK_BYTES = 6 * 1024 * 1024;
export const LEGACY_DIRECT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export const SUPPORTED_UPLOAD_EXTENSIONS = [
  "pdf", "docx", "pptx", "xlsx", "xls", "csv",
  "md", "txt", "json", "yaml", "yml", "gsp",
  "png", "jpg", "jpeg", "webp", "gif",
  "mp3", "mp4", "wav", "m4a",
] as const;

export const SUPPORTED_UPLOAD_LABEL = "PDF, DOCX, PPTX, XLSX, CSV, text, image, audio";

export type ScopeKind = "client" | "category" | "function" | "system";

export const SCOPE_KIND_LABELS: Record<ScopeKind, string> = {
  client: "Clients",
  category: "Categories",
  function: "Functions",
  system: "System",
};

export const SYSTEM_SCOPE_SLUGS = {
  workspace: "workspace",
  analyst: "analyst",
} as const;
