import { createSystemTemplateProfile } from "@basquio/template-engine";

import { TemplateCard, TemplateImportBox } from "@/components/template-library";
import { getViewerState } from "@/lib/supabase/auth";
import { fetchRestRows } from "@/lib/supabase/admin";
import { resolveViewerOrgId } from "@/lib/viewer-workspace";

export const dynamic = "force-dynamic";

type TemplateRow = {
  id: string;
  name: string | null;
  source_type: string;
  status: string;
  failure_message: string | null;
  layout_count: number | null;
  preview_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  template_profile: {
    templateName?: string;
    colors?: string[];
    fonts?: string[];
    brandTokens?: {
      typography?: { headingFont?: string; bodyFont?: string };
    };
  };
};

type DefaultSettingsRow = {
  default_template_profile_id: string | null;
};

async function loadTemplateData(orgId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { templates: [], defaultTemplateId: null };

  const [templates, settings] = await Promise.all([
    fetchRestRows<TemplateRow>({
      supabaseUrl,
      serviceKey,
      table: "template_profiles",
      query: {
        select: "id,name,source_type,status,failure_message,layout_count,preview_payload,created_at,updated_at,template_profile",
        organization_id: `eq.${orgId}`,
        order: "created_at.desc",
        limit: "50",
      },
    }).catch(() => []),
    fetchRestRows<DefaultSettingsRow>({
      supabaseUrl,
      serviceKey,
      table: "organization_template_settings",
      query: {
        select: "default_template_profile_id",
        organization_id: `eq.${orgId}`,
        limit: "1",
      },
    }).catch(() => []),
  ]);

  return {
    templates,
    defaultTemplateId: settings[0]?.default_template_profile_id ?? null,
  };
}

export default async function TemplatesPage() {
  const viewer = await getViewerState();
  const systemTemplate = createSystemTemplateProfile();
  const orgId = viewer.user ? await resolveViewerOrgId(viewer.user.id) : null;
  const { templates, defaultTemplateId } = orgId
    ? await loadTemplateData(orgId)
    : { templates: [], defaultTemplateId: null };

  const hasCustomDefault = defaultTemplateId !== null;
  const defaultTemplate = templates.find((t) => t.id === defaultTemplateId);

  const templateItems = templates.map((t) => ({
    id: t.id,
    name: t.name || t.template_profile?.templateName || `Custom ${t.source_type}`,
    sourceType: t.source_type,
    status: t.status ?? "ready",
    failureMessage: t.failure_message,
    colors: ((t.preview_payload?.colors ?? t.template_profile?.colors ?? []) as string[]).slice(0, 6),
    fonts: ((t.preview_payload?.fonts ?? t.template_profile?.fonts ?? []) as string[]).slice(0, 4),
    headingFont: ((t.preview_payload as Record<string, unknown>)?.headingFont as string) ?? t.template_profile?.brandTokens?.typography?.headingFont ?? null,
    isDefault: t.id === defaultTemplateId,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  }));

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>Templates</h1>
      </section>

      <section className="workspace-board">
        {/* Workspace default */}
        <article className="panel stack-xl">
          <div className="stack">
            <div className="row split">
              <div className="stack-xs">
                <p className="artifact-kind">Workspace default</p>
                <h2>{hasCustomDefault && defaultTemplate
                  ? (defaultTemplate.name || defaultTemplate.template_profile?.templateName || "Custom template")
                  : "Basquio Standard"}</h2>
              </div>
              <span className="run-pill run-pill-ready">
                {hasCustomDefault && defaultTemplate?.status === "processing" ? "Processing" : "Active"}
              </span>
            </div>
            <p className="muted">
              {hasCustomDefault
                ? "This template is used automatically on every new report. Change it below or switch back to Basquio Standard."
                : "Clean editorial design with accent colors. Used automatically when no custom template is selected."}
            </p>
          </div>

          <div className="brand-preview-strip">
            {(hasCustomDefault && defaultTemplate
              ? ((defaultTemplate.preview_payload?.colors ?? defaultTemplate.template_profile?.colors ?? []) as string[]).slice(0, 6)
              : systemTemplate.colors.slice(0, 6)
            ).map((color) => (
              <div key={color} className="brand-preview-swatch">
                <span className="swatch-color" style={{ backgroundColor: color }} />
                <span>{color}</span>
              </div>
            ))}
          </div>

          <div className="compact-meta-row">
            <span className="run-pill">
              {hasCustomDefault && defaultTemplate
                ? (((defaultTemplate.preview_payload as Record<string, unknown>)?.headingFont as string) ?? defaultTemplate.template_profile?.fonts?.[0] ?? "System fonts")
                : (systemTemplate.fonts?.[0] ?? "System fonts")}
            </span>
            <span className="run-pill">16:9 widescreen</span>
            <span className="run-pill">
              {hasCustomDefault ? "Custom" : "Basquio Standard"}
            </span>
          </div>
        </article>

        {/* Import new template */}
        <TemplateImportBox />
      </section>

      {/* Empty state */}
      {templateItems.length === 0 ? (
        <section className="panel stack">
          <div className="stack-xs">
            <h3>No custom templates yet</h3>
            <p className="muted">
              Want your own corporate style on every report? Import a PowerPoint template once and set it as your workspace default.
            </p>
          </div>
        </section>
      ) : null}

      {/* Saved templates list */}
      {templateItems.length > 0 ? (
        <section className="stack-lg">
          <div className="workspace-section-head">
            <h2>Saved templates</h2>
          </div>

          <div className="presentation-list">
            {templateItems.map((t) => (
              <TemplateCard key={t.id} template={t} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
