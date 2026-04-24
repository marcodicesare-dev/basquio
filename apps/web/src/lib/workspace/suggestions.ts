import "server-only";

import { unstable_cache } from "next/cache";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_ORG_ID, BASQUIO_TEAM_WORKSPACE_ID } from "@/lib/workspace/constants";

export type WorkspaceSuggestion = {
  id: string;
  kind: "summarize" | "investigate" | "narrate" | "retry";
  prompt: string;
  reason: string;
  ctaLabel?: string;
};

export type BuildSuggestionOptions = {
  maxItems?: number;
  scopeId?: string | null;
  scopeName?: string | null;
  locale?: "en" | "it";
};

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

const ONE_DAY = 1000 * 60 * 60 * 24;

export async function buildSuggestions(
  maxItemsOrOptions: number | BuildSuggestionOptions = 3,
): Promise<WorkspaceSuggestion[]> {
  const options =
    typeof maxItemsOrOptions === "number"
      ? { maxItems: maxItemsOrOptions }
      : maxItemsOrOptions;
  return cachedBuildSuggestions(
    Math.min(Math.max(options.maxItems ?? 3, 1), 3),
    options.scopeId ?? null,
    options.scopeName ?? null,
    options.locale ?? "en",
  );
}

const cachedBuildSuggestions = unstable_cache(
  async (
    maxItems: number,
    scopeId: string | null,
    scopeName: string | null,
    locale: "en" | "it",
  ): Promise<WorkspaceSuggestion[]> => {
    return buildSuggestionsUncached({ maxItems, scopeId, scopeName, locale });
  },
  ["workspace-suggestions-v3"],
  { revalidate: 300 },
);

async function buildSuggestionsUncached({
  maxItems,
  scopeId,
  scopeName,
  locale,
}: Required<BuildSuggestionOptions>): Promise<WorkspaceSuggestion[]> {
  const db = getDb();
  const since = new Date(Date.now() - 14 * ONE_DAY).toISOString();

  const recentDeliverablesQuery = db
    .from("workspace_deliverables")
    .select("id, prompt, status, created_at, workspace_scope_id")
    .eq("organization_id", BASQUIO_TEAM_ORG_ID)
    .eq("is_team_beta", true)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);

  const recentMemoryQuery = db
    .from("memory_entries")
    .select("id, memory_type, path, content, updated_at, workspace_scope_id")
    .eq("workspace_id", BASQUIO_TEAM_WORKSPACE_ID)
    .eq("is_team_beta", true)
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(12);

  if (scopeId) {
    recentDeliverablesQuery.eq("workspace_scope_id", scopeId);
    recentMemoryQuery.eq("workspace_scope_id", scopeId);
  }

  const [recentDocs, recentDeliverables, recentMemory, recentBrandEntities] = await Promise.all([
    db
      .from("knowledge_documents")
      .select("id, filename, created_at")
      .eq("organization_id", BASQUIO_TEAM_ORG_ID)
      .eq("is_team_beta", true)
      .eq("status", "indexed")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10),
    recentDeliverablesQuery,
    recentMemoryQuery,
    db
      .from("entities")
      .select("id, canonical_name, type")
      .eq("organization_id", BASQUIO_TEAM_ORG_ID)
      .eq("is_team_beta", true)
      .in("type", ["brand", "category"])
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const suggestions: WorkspaceSuggestion[] = [];
  const docs = (recentDocs.data ?? []) as Array<{ id: string; filename: string; created_at: string }>;
  const deliverables = (recentDeliverables.data ?? []) as Array<{
    id: string;
    prompt: string;
    status: string;
    created_at: string;
    workspace_scope_id: string | null;
  }>;
  const memories = (recentMemory.data ?? []) as Array<{
    id: string;
    memory_type: string;
    path: string;
    content: string;
    updated_at: string;
    workspace_scope_id: string | null;
  }>;
  const brandsAndCategories = (recentBrandEntities.data ?? []) as Array<{
    id: string;
    canonical_name: string;
    type: string;
  }>;

  const promptsCovered = new Set(
    deliverables.map((d) => d.prompt.toLowerCase().trim()),
  );

  for (const fail of deliverables.filter((d) => d.status === "failed").slice(0, 1)) {
    suggestions.push({
      id: `retry-${fail.id}`,
      kind: "retry",
      prompt: fail.prompt,
      reason: text(locale, "failed-retry", { scopeName }),
      ctaLabel: text(locale, "use-in-chat", {}),
    });
  }

  for (const memory of memories.slice(0, 2)) {
    const label = formatMemoryLabel(memory.path || memory.memory_type);
    const prompt = scopeName
      ? text(locale, "memory-scope-prompt", { label, scopeName })
      : text(locale, "memory-home-prompt", { label });
    if (promptsCovered.has(prompt.toLowerCase())) continue;
    suggestions.push({
      id: `memory-${memory.id}`,
      kind: "investigate",
      prompt,
      reason: text(locale, "memory-reason", { age: formatRelative(memory.updated_at, locale) }),
      ctaLabel: text(locale, "use-in-chat", {}),
    });
    if (suggestions.length >= maxItems) break;
  }

  for (const doc of docs.slice(0, 3)) {
    const prompt = text(locale, "summarize-doc", { filename: formatMemoryLabel(doc.filename) });
    if (promptsCovered.has(prompt.toLowerCase())) continue;
    suggestions.push({
      id: `summarize-${doc.id}`,
      kind: "summarize",
      prompt,
      reason: text(locale, "indexed-reason", { age: formatRelative(doc.created_at, locale) }),
      ctaLabel: text(locale, "use-in-chat", {}),
    });
    if (suggestions.length >= maxItems) break;
  }

  if (suggestions.length < maxItems) {
    for (const entity of brandsAndCategories) {
      const prompt =
        entity.type === "brand"
          ? text(locale, "brand-narrative", { name: entity.canonical_name })
          : text(locale, "category-map", { name: entity.canonical_name });
      if (promptsCovered.has(prompt.toLowerCase())) continue;
      suggestions.push({
        id: `narrate-${entity.id}`,
        kind: "narrate",
        prompt,
        reason: text(locale, "entity-reason", { name: entity.canonical_name }),
        ctaLabel: text(locale, "use-in-chat", {}),
      });
      if (suggestions.length >= maxItems) break;
    }
  }

  return suggestions.slice(0, maxItems);
}

function formatRelative(iso: string, locale: "en" | "it"): string {
  const created = new Date(iso);
  const diffSec = Math.round((Date.now() - created.getTime()) / 1000);
  if (diffSec < 60) return locale === "it" ? "adesso" : "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ${locale === "it" ? "fa" : "ago"}`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} h ${locale === "it" ? "fa" : "ago"}`;
  const days = Math.floor(diffSec / 86400);
  return locale === "it" ? `${days} g fa` : `${days}d ago`;
}

function formatMemoryLabel(value: string): string {
  const leaf = value.split("/").filter(Boolean).pop() ?? value;
  const withoutExtension = leaf.replace(/\.[a-z0-9]+$/i, "");
  const cleaned = withoutExtension
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "saved context";
  return cleaned
    .split(" ")
    .map((word, index) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      const lower = word.toLowerCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

function text(
  locale: "en" | "it",
  key:
    | "failed-retry"
    | "use-in-chat"
    | "memory-scope-prompt"
    | "memory-home-prompt"
    | "memory-reason"
    | "summarize-doc"
    | "indexed-reason"
    | "brand-narrative"
    | "category-map"
    | "entity-reason",
  vars: Record<string, string | null | undefined>,
) {
  const v = (name: string) => vars[name] ?? "";
  if (locale === "it") {
    switch (key) {
      case "failed-retry":
        return "L'ultimo tentativo non è riuscito. Ora vale la pena riprovare con le fonti indicizzate.";
      case "use-in-chat":
        return "Usa in chat";
      case "memory-scope-prompt":
        return `Usa ${v("label")} nel prossimo brief per ${v("scopeName")}.`;
      case "memory-home-prompt":
        return `Usa ${v("label")} nel prossimo lavoro.`;
      case "memory-reason":
        return `Memoria salvata ${v("age")}.`;
      case "summarize-doc":
        return `Riassumi ${v("filename")}.`;
      case "indexed-reason":
        return `Indicizzato ${v("age")}.`;
      case "brand-narrative":
        return `Scrivi la narrativa Q1 per ${v("name")}.`;
      case "category-map":
        return `Mappa il panorama competitivo in ${v("name")}.`;
      case "entity-reason":
        return `${v("name")} appare nei tuoi upload ma non ha ancora una narrativa.`;
    }
  }
  switch (key) {
    case "failed-retry":
      return "Last attempt failed. Worth a retry now that more sources are indexed.";
    case "use-in-chat":
      return "Use in chat";
    case "memory-scope-prompt":
      return `Use ${v("label")} for the next ${v("scopeName")} brief.`;
    case "memory-home-prompt":
      return `Use ${v("label")} in the next piece of work.`;
    case "memory-reason":
      return `Saved memory updated ${v("age")}.`;
    case "summarize-doc":
      return `Summarize ${v("filename")}.`;
    case "indexed-reason":
      return `Indexed ${v("age")}.`;
    case "brand-narrative":
      return `Write the Q1 narrative for ${v("name")}.`;
    case "category-map":
      return `Map the competitive landscape in ${v("name")}.`;
    case "entity-reason":
      return `${v("name")} appears in your uploads but has no narrative on file.`;
  }
}
