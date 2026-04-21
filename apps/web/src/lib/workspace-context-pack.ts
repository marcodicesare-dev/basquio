import { createHash } from "node:crypto";

import {
  workspaceContextPackSchema,
  type WorkspaceContextPack,
} from "@basquio/types";
import { fetchRestRows } from "@/lib/supabase/admin";

type AttachedSourceFile = {
  id: string;
  kind: string;
  fileName: string;
  storageBucket: string;
  storagePath: string;
};

function stableStringify(value: unknown): string {
  if (typeof value === "undefined") {
    return "null";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function parseWorkspaceContextPack(value: unknown): WorkspaceContextPack | null {
  if (!value) {
    return null;
  }

  const parsed = workspaceContextPackSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function hashWorkspaceContextPack(pack: WorkspaceContextPack | null) {
  if (!pack) {
    return null;
  }

  return createHash("sha256").update(stableStringify(pack)).digest("hex");
}

export function canonicalizeWorkspaceContextPack(
  pack: WorkspaceContextPack | null,
  attachedSourceFiles: AttachedSourceFile[],
): WorkspaceContextPack | null {
  if (!pack) {
    return null;
  }

  const sourceFileMap = new Map(attachedSourceFiles.map((file) => [file.id, file]));

  const canonicalSourceFiles: WorkspaceContextPack["sourceFiles"] = [];
  const seenSourceFileIds = new Set<string>();

  for (const sourceFile of pack.sourceFiles) {
    const attached = sourceFileMap.get(sourceFile.id);
    if (!attached || seenSourceFileIds.has(attached.id)) {
      continue;
    }

    canonicalSourceFiles.push({
      id: attached.id,
      kind: attached.kind,
      fileName: attached.fileName,
      storageBucket: attached.storageBucket,
      storagePath: attached.storagePath,
    });
    seenSourceFileIds.add(attached.id);
  }

  const canonicalCitedSources = pack.citedSources.map((source) => ({
    ...source,
    sourceFileId:
      source.sourceFileId && sourceFileMap.has(source.sourceFileId)
        ? source.sourceFileId
        : null,
  }));

  return {
    ...pack,
    workspaceScopeId: pack.workspaceScopeId ?? pack.scope.id ?? null,
    sourceFiles: canonicalSourceFiles,
    citedSources: canonicalCitedSources,
    styleContract: {
      ...pack.styleContract,
      chartPreferences: [...new Set(pack.styleContract.chartPreferences)],
    },
    rules: {
      workspace: [...new Set(pack.rules.workspace)],
      analyst: [...new Set(pack.rules.analyst)],
      scoped: [...new Set(pack.rules.scoped)],
    },
  };
}

export async function loadSourceFilesForWorkspaceContext(input: {
  supabaseUrl: string;
  serviceKey: string;
  organizationId: string;
  projectId: string;
  sourceFileIds: string[];
  uploadedSourceFiles: AttachedSourceFile[];
}) {
  const authoritativeRows = new Map(input.uploadedSourceFiles.map((file) => [file.id, file]));
  const existingIds = input.sourceFileIds.filter((id) => !authoritativeRows.has(id));

  if (existingIds.length > 0) {
    const existingRows = await fetchRestRows<{
      id: string;
      kind: string;
      file_name: string;
      storage_bucket: string;
      storage_path: string;
    }>({
      supabaseUrl: input.supabaseUrl,
      serviceKey: input.serviceKey,
      table: "source_files",
      query: {
        select: "id,kind,file_name,storage_bucket,storage_path",
        id: `in.(${existingIds.join(",")})`,
        organization_id: `eq.${input.organizationId}`,
        project_id: `eq.${input.projectId}`,
      },
    }).catch(() => []);

    for (const row of existingRows) {
      authoritativeRows.set(row.id, {
        id: row.id,
        kind: row.kind,
        fileName: row.file_name,
        storageBucket: row.storage_bucket,
        storagePath: row.storage_path,
      });
    }
  }

  return input.sourceFileIds
    .map((id) => authoritativeRows.get(id) ?? null)
    .filter((file): file is NonNullable<typeof file> => Boolean(file));
}

export async function loadPersistedRunWorkspaceContextPack(input: {
  supabaseUrl: string;
  serviceKey: string;
  runId: string | null | undefined;
  viewerId: string;
}) {
  if (!input.runId) {
    return null;
  }

  const rows = await fetchRestRows<{
    workspace_context_pack: unknown;
  }>({
    supabaseUrl: input.supabaseUrl,
    serviceKey: input.serviceKey,
    table: "deck_runs",
    query: {
      select: "workspace_context_pack",
      id: `eq.${input.runId}`,
      requested_by: `eq.${input.viewerId}`,
      limit: "1",
    },
  }).catch(() => []);

  return parseWorkspaceContextPack(rows[0]?.workspace_context_pack ?? null);
}

export function resolveAuthoritativeWorkspaceContextPack(input: {
  persistedPack?: WorkspaceContextPack | null;
  clientPack?: WorkspaceContextPack | null;
  attachedSourceFiles: AttachedSourceFile[];
}) {
  return canonicalizeWorkspaceContextPack(
    input.persistedPack ?? input.clientPack ?? null,
    input.attachedSourceFiles,
  );
}
