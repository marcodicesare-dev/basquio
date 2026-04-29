import { NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { createMemoryEntry } from "@/lib/workspace/memory";
import { createWorkspacePerson } from "@/lib/workspace/people";
import { createScope, getScopeByKindSlug, listScopes } from "@/lib/workspace/scopes";
import {
  getCurrentWorkspace,
  isWorkspaceOnboarded,
  markWorkspaceOnboarded,
} from "@/lib/workspace/workspaces";

export const runtime = "nodejs";

const roleSchema = z.enum(["analyst", "consultant", "trade_marketing", "other"]);

const scopeInputSchema = z.object({
  kind: z.enum(["client", "category", "function"]),
  name: z.string().trim().min(1).max(120),
});

const stakeholderInputSchema = z.object({
  scope_kind: z.enum(["client", "category", "function"]),
  scope_slug: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  role: z.string().trim().max(200).optional(),
  preference: z.string().trim().max(600).optional(),
});

const bodySchema = z.object({
  role: roleSchema,
  role_other: z.string().max(200).optional(),
  scopes: z.array(scopeInputSchema).max(20).default([]),
  stakeholders: z.array(stakeholderInputSchema).max(60).default([]),
  skipped: z.boolean().default(false),
});

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const ROLE_LABELS: Record<z.infer<typeof roleSchema>, string> = {
  analyst: "Internal analyst",
  consultant: "Agency consultant",
  trade_marketing: "Trade marketing",
  other: "Other",
};

export async function POST(request: Request) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid body." },
      { status: 400 },
    );
  }

  const workspace = await getCurrentWorkspace(viewer);

  // If someone already finished, short-circuit.
  if (isWorkspaceOnboarded(workspace) && !payload.skipped) {
    return NextResponse.json(
      { workspace_id: workspace.id, already_onboarded: true },
      { status: 200 },
    );
  }

  const existingScopes = await listScopes(workspace.id);
  const existingByKey = new Map(existingScopes.map((s) => [`${s.kind}:${s.slug}`, s]));
  const analystScope =
    existingScopes.find((s) => s.kind === "system" && s.slug === "analyst") ??
    existingScopes.find((s) => s.kind === "system") ??
    null;

  const createdScopes: Array<{ kind: string; name: string; slug: string; id: string }> = [];
  const targetScopes: Array<{ kind: string; name: string; slug: string; id: string }> = [];
  const scopeByInputSlug = new Map<string, string>();

  if (!payload.skipped) {
    for (const raw of payload.scopes) {
      const slug = slugify(raw.name);
      if (!slug) continue;
      const key = `${raw.kind}:${slug}`;
      const existing = existingByKey.get(key);
      if (existing) {
        scopeByInputSlug.set(key, existing.id);
        targetScopes.push({
          kind: existing.kind,
          name: existing.name,
          slug: existing.slug,
          id: existing.id,
        });
        continue;
      }
      const scope = await createScope({
        workspaceId: workspace.id,
        kind: raw.kind,
        name: raw.name,
        slug,
        metadata: { created_via: "onboarding" },
      }).catch((err) => {
        console.error("[onboarding] createScope failed", err);
        return null;
      });
      if (scope) {
        scopeByInputSlug.set(key, scope.id);
        const summary = { kind: scope.kind, name: scope.name, slug: scope.slug, id: scope.id };
        createdScopes.push(summary);
        targetScopes.push(summary);
      }
    }

    // Resolve scope for each stakeholder (tolerates users picking slugs we just created)
    for (const raw of payload.stakeholders) {
      const key = `${raw.scope_kind}:${raw.scope_slug}`;
      let scopeId = scopeByInputSlug.get(key) ?? existingByKey.get(key)?.id;
      if (!scopeId) {
        const fresh = await getScopeByKindSlug(workspace.id, raw.scope_kind, raw.scope_slug);
        scopeId = fresh?.id;
      }
      if (!scopeId) continue;

      const preferences = raw.preference
        ? { free_text: raw.preference }
        : undefined;

      const person = await createWorkspacePerson({
        workspaceId: workspace.id,
        canonicalName: raw.name,
        role: raw.role || undefined,
        preferences,
        linkedScopeId: scopeId,
        createdBy: viewer.user.id,
      }).catch((err) => {
        console.error("[onboarding] createWorkspacePerson failed", err);
        return null;
      });

      if (person && raw.preference) {
        await createMemoryEntry({
          workspaceId: workspace.id,
          workspaceScopeId: scopeId,
          memoryType: "procedural",
          content: `For ${raw.name}${raw.role ? ` (${raw.role})` : ""}: ${raw.preference}`,
          metadata: {
            taught_by: viewer.user.email ?? "onboarding",
            source: "onboarding",
            person_id: person.id,
          },
        }).catch((err) => {
          console.error("[onboarding] memory entry failed", err);
        });
      }
    }

    // Seed analyst-scope procedural memory with role
    if (analystScope) {
      const roleLabel = payload.role === "other" && payload.role_other
        ? payload.role_other
        : ROLE_LABELS[payload.role];
      await createMemoryEntry({
        workspaceId: workspace.id,
        workspaceScopeId: analystScope.id,
        memoryType: "procedural",
        content: `Analyst role: ${roleLabel}. Tailor tone and output density to this role.`,
        path: "/preferences/analyst-role.md",
        metadata: {
          taught_by: viewer.user.email ?? "onboarding",
          source: "onboarding",
          role: payload.role,
        },
      }).catch((err) => {
        console.error("[onboarding] analyst role memory failed", err);
      });
    }
  }

  const updated = await markWorkspaceOnboarded(
    workspace.id,
    viewer.user.id,
    payload.role,
  );

  return NextResponse.json({
    workspace_id: updated.id,
    onboarded_at: updated.metadata?.onboarded_at ?? null,
    scopes_created: createdScopes.length,
    first_scope: targetScopes[0]
      ? {
          kind: targetScopes[0].kind,
          slug: targetScopes[0].slug,
        }
      : null,
    skipped: payload.skipped,
  });
}
