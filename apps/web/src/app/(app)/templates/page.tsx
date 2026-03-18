import Link from "next/link";

import { createSystemTemplateProfile } from "@basquio/template-engine";

import { getViewerState } from "@/lib/supabase/auth";
import { fetchRestRows } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type SavedTemplate = {
  id: string;
  source_type: string;
  created_at: string;
  template_profile: {
    templateName?: string;
    sourceType?: string;
    colors?: string[];
    fonts?: string[];
    brandTokens?: {
      typography?: { headingFont?: string; bodyFont?: string };
    };
  };
};

async function listSavedTemplates(organizationId: string): Promise<SavedTemplate[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];

  try {
    return await fetchRestRows<SavedTemplate>({
      supabaseUrl,
      serviceKey,
      table: "template_profiles",
      query: {
        select: "id,source_type,created_at,template_profile",
        organization_id: `eq.${organizationId}`,
        order: "created_at.desc",
        limit: "20",
      },
    });
  } catch {
    return [];
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function sourceTypeLabel(sourceType: string) {
  switch (sourceType) {
    case "pptx": return "PowerPoint template";
    case "brand-tokens": return "Brand tokens (JSON/CSS)";
    case "pdf-style-reference": return "PDF style reference";
    case "system": return "Basquio default";
    default: return "Custom template";
  }
}

export default async function TemplatesPage() {
  const viewer = await getViewerState();
  const systemTemplate = createSystemTemplateProfile();

  // Fetch saved custom templates for the org
  const orgId = (viewer.user as { user_metadata?: { organization_id?: string } } | undefined)?.user_metadata?.organization_id;
  const savedTemplates = orgId ? await listSavedTemplates(orgId) : [];

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>Templates</h1>

        <Link className="button" href="/jobs/new">
          New report
        </Link>
      </section>

      <section className="workspace-board">
        {/* Default Basquio template — always shown */}
        <article className="panel stack-xl">
          <div className="stack">
            <div className="row split">
              <div className="stack-xs">
                <p className="artifact-kind">Default template</p>
                <h2>Basquio Standard</h2>
              </div>
              <span className="run-pill">Active</span>
            </div>
            <p className="muted">
              Clean editorial design with accent colors. Used automatically when no custom template is uploaded.
              To use a custom template, upload a PPTX, JSON, or CSS file when creating a new report.
            </p>
          </div>

          <div className="brand-preview-strip">
            {systemTemplate.colors.slice(0, 6).map((color) => (
              <div key={color} className="brand-preview-swatch">
                <span className="swatch-color" style={{ backgroundColor: color }} />
                <span>{color}</span>
              </div>
            ))}
          </div>

          <div className="compact-meta-row">
            <span className="run-pill">{systemTemplate.fonts?.[0] ?? "System fonts"}</span>
            <span className="run-pill">16:9 widescreen</span>
            <span className="run-pill">12 slide layouts</span>
          </div>
        </article>

        {/* Saved custom templates from the org */}
        {savedTemplates.length > 0 ? (
          <>
            <div className="workspace-section-head">
              <h2>Your uploaded templates</h2>
            </div>

            <div className="presentation-list">
              {savedTemplates.map((t) => {
                const profile = t.template_profile;
                const colors = profile.colors ?? [];
                const templateName = profile.templateName || sourceTypeLabel(t.source_type);
                const headingFont = profile.brandTokens?.typography?.headingFont;

                return (
                  <article key={t.id} className="panel presentation-card">
                    <div className="stack">
                      <p className="artifact-kind">{sourceTypeLabel(t.source_type)}</p>
                      <h3>{templateName}</h3>
                    </div>

                    {colors.length > 0 ? (
                      <div className="brand-preview-strip">
                        {colors.slice(0, 4).map((color) => (
                          <div key={color} className="brand-preview-swatch">
                            <span className="swatch-color" style={{ backgroundColor: color }} />
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="compact-meta-row">
                      {headingFont ? <span className="run-pill">{headingFont}</span> : null}
                      <span className="run-pill">{formatDate(t.created_at)}</span>
                      <span className="run-pill">ID: {t.id.slice(-8)}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : null}

        {/* How templates work — always visible */}
        <article className="panel stack">
          <h3>How templates work</h3>
          <div className="stack-xs">
            <p className="muted">
              When you create a new report, you can optionally upload a PowerPoint template (.pptx),
              brand tokens file (.json or .css), or a PDF style reference.
            </p>
            <p className="muted">
              Basquio extracts your colors, fonts, and style tokens and applies them to the locked slide grid.
              The grid ensures every slide is clean and non-overlapping regardless of content density.
            </p>
            <p className="muted">
              If no template is uploaded, the Basquio Standard design is used automatically.
              Every template maps onto the same locked archetype library — only colors, fonts, and chrome change.
            </p>
          </div>
        </article>
      </section>
    </div>
  );
}
