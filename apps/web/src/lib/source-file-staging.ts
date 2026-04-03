import { randomUUID } from "node:crypto";

import { normalizePersistedSourceFileKind } from "@/lib/source-file-kinds";

export type SourceFileTransport = {
  fileName: string;
  mediaType?: string | null;
  kind?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
  fileBytes?: number | null;
};

export type StagedSourceFile = {
  id: string;
  storageBucket: string;
  storagePath: string;
};

export async function persistPreparedSourceFiles(input: {
  supabaseUrl: string;
  serviceKey: string;
  organizationId: string;
  projectId: string;
  uploadedBy: string;
  files: SourceFileTransport[];
}) {
  if (input.files.length === 0) {
    return [] as StagedSourceFile[];
  }

  const rows = input.files.map((file) => {
    if (!file.storageBucket || !file.storagePath) {
      throw new Error(`Prepared upload for ${file.fileName} is missing storage metadata.`);
    }

    return {
      id: randomUUID(),
      organization_id: input.organizationId,
      project_id: input.projectId,
      uploaded_by: input.uploadedBy,
      kind: normalizePersistedSourceFileKind(file.kind ?? null, file.fileName),
      file_name: file.fileName,
      storage_bucket: file.storageBucket,
      storage_path: file.storagePath,
      file_bytes: file.fileBytes ?? 0,
      media_type: file.mediaType ?? "application/octet-stream",
    };
  });

  const response = await fetch(`${input.supabaseUrl}/rest/v1/source_files`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: input.serviceKey,
      Authorization: `Bearer ${input.serviceKey}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(rows),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Failed to create source_files records: ${errorText}`);
  }

  const created = (await response.json()) as Array<{
    id: string;
    storage_bucket: string;
    storage_path: string;
  }>;

  return created.map((row) => ({
    id: row.id,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
  }));
}
