/**
 * Memory v1 Brief 3 placeholder UI for extracted brand rules.
 *
 * Server component. Reads the latest non-superseded brand_guideline row for
 * (workspace, brand) and renders the typed facets grouped by surface
 * (typography / colour / tone / imagery / forbidden / logo / layout). The
 * full Memory Inspector (with version history, supersession, audit
 * timeline) ships in Brief 5.
 */
import { getActiveBrandGuideline } from "@/lib/workspace/brand-guidelines";

type Props = {
  workspaceId: string;
  brand: string;
};

export async function WorkspaceBrandRules({ workspaceId, brand }: Props) {
  let guideline;
  try {
    guideline = await getActiveBrandGuideline(workspaceId, brand);
  } catch (err) {
    console.error("[WorkspaceBrandRules] read failed", err);
    return (
      <section className="wbeta-brand-rules wbeta-brand-rules-empty">
        <p>Could not load brand rules. Try again in a moment.</p>
      </section>
    );
  }

  if (!guideline) {
    return (
      <section className="wbeta-brand-rules wbeta-brand-rules-empty">
        <p>No brand rules extracted yet for {brand}. Upload a brand book and tag it as a brand book.</p>
      </section>
    );
  }

  const typography = arrayOf(guideline.typography);
  const colour = arrayOf(guideline.colour);
  const tone = arrayOf(guideline.tone);
  const imagery = arrayOf(guideline.imagery);
  const logo = arrayOf(guideline.logo);
  const layout = arrayOf(guideline.layout);
  const forbidden = guideline.forbidden ?? [];

  return (
    <section className="wbeta-brand-rules">
      <header className="wbeta-brand-rules-head">
        <h3>{guideline.brand}</h3>
        <span className="wbeta-brand-rules-version">
          v{guideline.version} · confidence {(guideline.extraction_confidence * 100).toFixed(0)}%
        </span>
      </header>

      <RuleGroup label="Typography" count={typography.length} kind="typography" rules={typography} />
      <RuleGroup label="Colour" count={colour.length} kind="colour" rules={colour} />
      <RuleGroup label="Tone" count={tone.length} kind="tone" rules={tone} />
      <RuleGroup label="Imagery" count={imagery.length} kind="imagery" rules={imagery} />
      <RuleGroup label="Logo" count={logo.length} kind="logo" rules={logo} />
      <RuleGroup label="Layout" count={layout.length} kind="layout" rules={layout} />
      {forbidden.length > 0 ? (
        <div className="wbeta-brand-rules-group">
          <header>
            <h4>Forbidden</h4>
            <span>{forbidden.length}</span>
          </header>
          <ul>
            {forbidden.map((word, i) => (
              <li key={`forbidden-${i}`}>{word}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function RuleGroup({
  label,
  count,
  kind,
  rules,
}: {
  label: string;
  count: number;
  kind: "typography" | "colour" | "tone" | "imagery" | "logo" | "layout";
  rules: unknown[];
}) {
  if (count === 0) return null;
  return (
    <div className="wbeta-brand-rules-group">
      <header>
        <h4>{label}</h4>
        <span>{count}</span>
      </header>
      <ul>
        {rules.map((rule, i) => (
          <li key={`${kind}-${i}`}>
            <RulePreview kind={kind} rule={rule} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RulePreview({
  kind,
  rule,
}: {
  kind: "typography" | "colour" | "tone" | "imagery" | "logo" | "layout";
  rule: unknown;
}) {
  if (!rule || typeof rule !== "object") {
    return <span>{String(rule)}</span>;
  }
  const r = rule as Record<string, unknown>;
  const sourcePage = typeof r.source_page === "number" ? r.source_page : null;
  const pageBadge = sourcePage ? <span className="wbeta-brand-rules-page">p.{sourcePage}</span> : null;

  if (kind === "typography") {
    return (
      <>
        <span className="wbeta-brand-rules-headline">
          {String(r.surface ?? "")} · {String(r.font_family ?? "")} {String(r.weight ?? "")}
          {r.size_px ? ` · ${r.size_px}px` : ""}
        </span>
        {pageBadge}
      </>
    );
  }

  if (kind === "colour") {
    const hex = typeof r.hex === "string" ? r.hex : "";
    return (
      <>
        {hex ? <span className="wbeta-brand-rules-swatch" style={{ background: hex }} /> : null}
        <span className="wbeta-brand-rules-headline">
          {String(r.name ?? "")} {hex}
        </span>
        {pageBadge}
      </>
    );
  }

  if (kind === "tone") {
    return (
      <>
        <span className="wbeta-brand-rules-headline">{String(r.voice_attribute ?? "")}</span>
        {pageBadge}
      </>
    );
  }

  if (kind === "imagery") {
    return (
      <>
        <span className="wbeta-brand-rules-headline">{String(r.rule ?? "")}</span>
        {pageBadge}
      </>
    );
  }

  // logo, layout: stored as plain strings in JSONB array
  return <span>{typeof rule === "string" ? rule : JSON.stringify(rule)}</span>;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
