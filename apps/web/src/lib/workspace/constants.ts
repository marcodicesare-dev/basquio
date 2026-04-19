/**
 * V1 Workspace constants. Per docs/spec-v1-workspace.md and docs/spec-v1-team-access-mode.md.
 *
 * V1 uses a single shared organization_id for every @basquio.com user so the
 * co-founders dogfood the same workspace. V2 introduces per-customer orgs
 * via a proper workspaces table and membership.
 */

export const BASQUIO_TEAM_ORG_ID = "15cc947e-70cb-455a-b0df-d8c34b760d71";

export const KNOWLEDGE_BUCKET = "knowledge-base";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const SUPPORTED_UPLOAD_EXTENSIONS = [
  "pdf", "docx", "pptx", "xlsx", "xls", "csv",
  "md", "txt", "json", "yaml", "yml",
  "png", "jpg", "jpeg", "webp", "gif",
  "mp3", "mp4", "wav", "m4a",
] as const;

export const SUPPORTED_UPLOAD_LABEL = "PDF, DOCX, PPTX, XLSX, CSV, text, image, audio";
