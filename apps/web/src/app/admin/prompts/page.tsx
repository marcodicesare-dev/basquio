export const dynamic = "force-dynamic";

const PROMPT_REGISTRY: Array<{
  name: string;
  version: string;
  model: string;
  source: string;
  brief: string;
  description: string;
}> = [
  {
    name: "chat-router-classifier",
    version: "v1.0",
    model: "claude-haiku-4-5",
    source: "apps/web/src/lib/workspace/router.ts",
    brief: "Brief 2",
    description: "5-enum intent classifier (metric, evidence, graph, rule, web).",
  },
  {
    name: "chat-system-prompt",
    version: "static",
    model: "claude-sonnet-4-6",
    source: "apps/web/src/lib/workspace/agent.ts (STATIC_SYSTEM_PROMPT)",
    brief: "Brief 2",
    description: "75-line FMCG analyst persona, 1h ephemeral cache.",
  },
  {
    name: "brand-extraction-extract",
    version: "v1.0",
    model: "claude-sonnet-4-6",
    source: "packages/workflows/baml_src/brand_guideline.baml ExtractBrandGuideline",
    brief: "Brief 3",
    description: "BAML extract: typography / colour / tone / imagery / forbidden / language / layout / logo with source_page on every rule.",
  },
  {
    name: "brand-extraction-validate",
    version: "v1.0",
    model: "claude-haiku-4-5",
    source: "packages/workflows/baml_src/brand_guideline.baml ValidateBrandGuideline",
    brief: "Brief 3",
    description: "BAML validate: 0.7 floor for persistence; rejects sparse extractions and malformed hex / weight / source_page.",
  },
  {
    name: "chat-fact-extraction",
    version: "v1.0",
    model: "claude-haiku-4-5",
    source: "packages/workflows/src/workspace/prompts/chat-fact-extraction.md (mirrored as TS const in chat-extraction.ts)",
    brief: "Brief 4",
    description: "Mem0 V3 ADD-only post-turn fact extractor (5 kinds, conservative).",
  },
];

export default function AdminPromptsPage() {
  return (
    <section className="wbeta-admin-page">
      <header>
        <h2>Prompts inventory</h2>
        <p className="wbeta-admin-summary">
          Read-only registry of prompts shipped on origin/main. Source paths are clickable inside
          the codebase but not from this admin surface. Bumping a prompt version requires a code
          commit; this page just shows what is live.
        </p>
      </header>

      <table className="wbeta-admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Version</th>
            <th>Model</th>
            <th>Brief</th>
            <th>Source</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {PROMPT_REGISTRY.map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td className="wbeta-admin-mono">{p.version}</td>
              <td className="wbeta-admin-mono">{p.model}</td>
              <td>{p.brief}</td>
              <td className="wbeta-admin-mono">{p.source}</td>
              <td>{p.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
