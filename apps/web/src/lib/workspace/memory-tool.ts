import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_ORG_ID } from "@/lib/workspace/constants";

export type MemoryCommand =
  | { command: "view"; path: string; view_range?: [number, number] }
  | { command: "create"; path: string; file_text: string }
  | { command: "str_replace"; path: string; old_str: string; new_str: string }
  | { command: "insert"; path: string; insert_line: number; insert_text: string }
  | { command: "delete"; path: string }
  | { command: "rename"; old_path: string; new_path: string };

const MEMORY_ROOT = "/memories";

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

function normalizePath(rawPath: string): string {
  let p = rawPath.trim();
  if (!p.startsWith("/")) p = "/" + p;
  const segments: string[] = [];
  for (const segment of p.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        throw new Error("Path traversal outside /memories is not allowed.");
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const normalized = "/" + segments.join("/");
  if (!normalized.startsWith(MEMORY_ROOT)) {
    throw new Error("Memory operations must stay under /memories.");
  }
  return normalized;
}

function splitScope(memoryPath: string): { scope: string; relativePath: string } {
  const trimmed = memoryPath.replace(MEMORY_ROOT, "");
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length === 0) {
    return { scope: "workspace", relativePath: "/" };
  }
  const scope = parts[0];
  const relativePath = "/" + parts.slice(1).join("/");
  return { scope, relativePath };
}

function inferMemoryType(path: string): "semantic" | "episodic" | "procedural" {
  const lower = path.toLowerCase();
  if (lower.includes("/procedural") || lower.includes("preferences") || lower.includes("style")) {
    return "procedural";
  }
  if (lower.includes("/episodic") || lower.includes("transcripts") || lower.includes("interactions")) {
    return "episodic";
  }
  return "semantic";
}

type MemoryRow = {
  id: string;
  scope: string;
  path: string;
  content: string;
  memory_type: "semantic" | "episodic" | "procedural";
};

async function fetchByPath(scope: string, path: string): Promise<MemoryRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from("memory_entries")
    .select("id, scope, path, content, memory_type")
    .eq("organization_id", BASQUIO_TEAM_ORG_ID)
    .eq("scope", scope)
    .eq("path", path)
    .maybeSingle();
  if (error) throw new Error(`Memory read failed: ${error.message}`);
  return data ? (data as MemoryRow) : null;
}

async function listChildren(scope: string, prefix: string): Promise<MemoryRow[]> {
  const db = getDb();
  const trimmedPrefix = prefix === "/" ? "/" : prefix.replace(/\/$/, "") + "/";
  const { data, error } = await db
    .from("memory_entries")
    .select("id, scope, path, content, memory_type")
    .eq("organization_id", BASQUIO_TEAM_ORG_ID)
    .eq("scope", scope)
    .like("path", `${trimmedPrefix}%`)
    .order("path", { ascending: true });
  if (error) throw new Error(`Memory list failed: ${error.message}`);
  return (data ?? []) as MemoryRow[];
}

async function listAllScopes(): Promise<string[]> {
  const db = getDb();
  const { data, error } = await db
    .from("memory_entries")
    .select("scope")
    .eq("organization_id", BASQUIO_TEAM_ORG_ID);
  if (error) throw new Error(`Memory scope list failed: ${error.message}`);
  const seen = new Set<string>();
  for (const row of data ?? []) {
    seen.add((row as { scope: string }).scope);
  }
  return Array.from(seen).sort();
}

export async function handleMemoryCommand(input: MemoryCommand): Promise<string> {
  if (input.command === "view") {
    const path = normalizePath(input.path);
    if (path === MEMORY_ROOT || path === MEMORY_ROOT + "/") {
      const scopes = await listAllScopes();
      if (scopes.length === 0) return "No memory yet.";
      return scopes.map((s) => `${MEMORY_ROOT}/${s}/`).join("\n");
    }

    const { scope, relativePath } = splitScope(path);

    const exact = await fetchByPath(scope, relativePath);
    if (exact) {
      const lines = exact.content.split("\n");
      let from = 1;
      let to = lines.length;
      if (input.view_range) {
        from = Math.max(1, Math.floor(input.view_range[0]));
        to = Math.min(lines.length, Math.floor(input.view_range[1]));
      }
      const slice = lines.slice(from - 1, to);
      return slice.map((line, idx) => `${from + idx}: ${line}`).join("\n");
    }

    const children = await listChildren(scope, relativePath);
    if (children.length === 0) {
      return `No memory at ${path}.`;
    }
    const seen = new Set<string>();
    const out: string[] = [];
    const trimmedPrefix = relativePath === "/" ? "/" : relativePath.replace(/\/$/, "") + "/";
    for (const row of children) {
      const sub = row.path.slice(trimmedPrefix.length);
      const head = sub.split("/")[0];
      if (!head || seen.has(head)) continue;
      seen.add(head);
      const isFile = !sub.includes("/");
      out.push(`${path === MEMORY_ROOT ? `${MEMORY_ROOT}/${scope}` : path}/${head}${isFile ? "" : "/"}`);
    }
    return out.join("\n");
  }

  if (input.command === "create") {
    const path = normalizePath(input.path);
    const { scope, relativePath } = splitScope(path);
    const memoryType = inferMemoryType(relativePath);

    const db = getDb();
    const existing = await fetchByPath(scope, relativePath);
    if (existing) {
      const { error } = await db
        .from("memory_entries")
        .update({ content: input.file_text, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) throw new Error(`Memory update failed: ${error.message}`);
    } else {
      const { error } = await db.from("memory_entries").insert({
        organization_id: BASQUIO_TEAM_ORG_ID,
        is_team_beta: true,
        scope,
        memory_type: memoryType,
        path: relativePath,
        content: input.file_text,
      });
      if (error) throw new Error(`Memory create failed: ${error.message}`);
    }
    return `File created successfully at: ${path}`;
  }

  if (input.command === "str_replace") {
    const path = normalizePath(input.path);
    const { scope, relativePath } = splitScope(path);
    const existing = await fetchByPath(scope, relativePath);
    if (!existing) return `File not found: ${path}`;
    if (!existing.content.includes(input.old_str)) {
      return `String not found in ${path}.`;
    }
    const updated = existing.content.replace(input.old_str, input.new_str);
    const db = getDb();
    const { error } = await db
      .from("memory_entries")
      .update({ content: updated, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(`Memory edit failed: ${error.message}`);
    return `The memory file has been edited.`;
  }

  if (input.command === "insert") {
    const path = normalizePath(input.path);
    const { scope, relativePath } = splitScope(path);
    const existing = await fetchByPath(scope, relativePath);
    if (!existing) return `File not found: ${path}`;
    const lines = existing.content.split("\n");
    const insertAt = Math.max(0, Math.min(lines.length, Math.floor(input.insert_line)));
    lines.splice(insertAt, 0, input.insert_text);
    const updated = lines.join("\n");
    const db = getDb();
    const { error } = await db
      .from("memory_entries")
      .update({ content: updated, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(`Memory insert failed: ${error.message}`);
    return `The file ${path} has been edited.`;
  }

  if (input.command === "delete") {
    const path = normalizePath(input.path);
    const { scope, relativePath } = splitScope(path);
    const db = getDb();
    const { error } = await db
      .from("memory_entries")
      .delete()
      .eq("organization_id", BASQUIO_TEAM_ORG_ID)
      .eq("scope", scope)
      .eq("path", relativePath);
    if (error) throw new Error(`Memory delete failed: ${error.message}`);
    return `Successfully deleted ${path}`;
  }

  if (input.command === "rename") {
    const oldPath = normalizePath(input.old_path);
    const newPath = normalizePath(input.new_path);
    const { scope: oldScope, relativePath: oldRel } = splitScope(oldPath);
    const { scope: newScope, relativePath: newRel } = splitScope(newPath);
    const existing = await fetchByPath(oldScope, oldRel);
    if (!existing) return `File not found: ${oldPath}`;
    const db = getDb();
    const { error } = await db
      .from("memory_entries")
      .update({ scope: newScope, path: newRel, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(`Memory rename failed: ${error.message}`);
    return `Successfully renamed ${oldPath} to ${newPath}`;
  }

  return "Unsupported memory command.";
}
