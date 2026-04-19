import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_ORG_ID } from "@/lib/workspace/constants";

export type WorkspaceSuggestion = {
  id: string;
  kind: "summarize" | "investigate" | "narrate" | "retry";
  prompt: string;
  reason: string;
};

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

const ONE_DAY = 1000 * 60 * 60 * 24;

export async function buildSuggestions(maxItems = 3): Promise<WorkspaceSuggestion[]> {
  const db = getDb();
  const since = new Date(Date.now() - 14 * ONE_DAY).toISOString();

  const [recentDocs, recentDeliverables, recentBrandEntities] = await Promise.all([
    db
      .from("knowledge_documents")
      .select("id, filename, created_at")
      .eq("organization_id", BASQUIO_TEAM_ORG_ID)
      .eq("is_team_beta", true)
      .eq("status", "indexed")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10),
    db
      .from("workspace_deliverables")
      .select("id, prompt, status, created_at")
      .eq("organization_id", BASQUIO_TEAM_ORG_ID)
      .eq("is_team_beta", true)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20),
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
      reason: "Last attempt failed. Worth a retry now that more sources are indexed.",
    });
  }

  for (const doc of docs.slice(0, 3)) {
    const prompt = `Summarize the key findings in ${doc.filename}.`;
    if (promptsCovered.has(prompt.toLowerCase())) continue;
    suggestions.push({
      id: `summarize-${doc.id}`,
      kind: "summarize",
      prompt,
      reason: `Indexed ${formatRelative(doc.created_at)}. No summary deliverable yet.`,
    });
    if (suggestions.length >= maxItems) break;
  }

  if (suggestions.length < maxItems) {
    for (const entity of brandsAndCategories) {
      const prompt =
        entity.type === "brand"
          ? `Write the Q1 narrative for ${entity.canonical_name}.`
          : `Map the competitive landscape in ${entity.canonical_name}.`;
      if (promptsCovered.has(prompt.toLowerCase())) continue;
      suggestions.push({
        id: `narrate-${entity.id}`,
        kind: "narrate",
        prompt,
        reason: `${entity.canonical_name} appears in your uploads but has no narrative on file.`,
      });
      if (suggestions.length >= maxItems) break;
    }
  }

  return suggestions.slice(0, maxItems);
}

function formatRelative(iso: string): string {
  const created = new Date(iso);
  const diffSec = Math.round((Date.now() - created.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} h ago`;
  const days = Math.floor(diffSec / 86400);
  return `${days}d ago`;
}
