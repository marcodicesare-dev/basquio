// ── Knowledge Base Types ────────────────────────────────────────

export interface ParseResult {
  text: string;
  pages?: PageContent[];
  metadata: {
    pageCount?: number;
    slideCount?: number;
    hasImages: boolean;
    language?: string;
  };
}

export interface PageContent {
  pageNumber: number;
  text: string;
}

export interface SearchResult {
  answer: string;
  sources: Source[];
  confidence: "high" | "medium" | "low";
}

export interface Source {
  type: "document" | "transcript";
  name: string;
  snippet: string;
  page?: number;
  storageUrl?: string;
  metadata: Record<string, unknown>;
}

export interface HybridSearchRow {
  chunk_id: string;
  source_type: string;
  source_id: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

export const SUPPORTED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
};

export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
