"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import type { MarketingVariant } from "@/app/marketing-variant-config";

const inputLabels = ["Brief", "Data", "Notes", "Template", "Past work"];
const italianInputLabels = ["Brief", "Dati", "Appunti", "Template", "Lavori passati"];

const outputTabs = [
  { id: "deck", label: "Deck", title: "Presentation", detail: "Storyboard, charts, recommendations, and source notes." },
  { id: "report", label: "Report", title: "Narrative report", detail: "What changed, why it matters, and what the team should do next." },
  { id: "excel", label: "Excel", title: "Workbook", detail: "Tables behind the claims, formatted for audit and review." },
] as const;

const buyerRoutes = [
  {
    title: "I need one output",
    copy: "Upload the material, see the estimate, buy credits, and run the deck, report, or Excel file.",
    cta: "Start pay as you go",
    href: "/pay-as-you-go",
    marker: "01",
  },
  {
    title: "I work on recurring projects",
    copy: "Keep clients, templates, notes, and past work in a private workspace for one person.",
    cta: "See Workspace Pro",
    href: "/workspace-pro",
    marker: "02",
  },
  {
    title: "My team does this every month",
    copy: "Shared memory for brands, categories, stakeholders, templates, and previous reviews.",
    cta: "See Team Workspace",
    href: "/team-workspace",
    marker: "03",
  },
] as const;

const rememberedItems = [
  "Briefs",
  "Data files",
  "Transcripts",
  "Notes",
  "Templates",
  "Brand rules",
  "Stakeholders",
  "Past reviews",
] as const;

const pricingPaths = [
  {
    name: "Pay as you go",
    price: "Estimated before purchase",
    copy: "For one deck, report, or Excel file. No subscription and no workspace setup.",
    href: "/pay-as-you-go",
    cta: "Estimate one output",
  },
  {
    name: "Workspace Pro",
    price: "199 per month",
    copy: "One private workspace for recurring clients, notes, templates, and outputs.",
    href: "/workspace-pro",
    cta: "Start 7-day trial",
  },
  {
    name: "Team Workspace",
    price: "From 500 per month",
    copy: "Shared workspace, onboarding, shared memory, projects, and normal team usage.",
    href: "/team-workspace",
    cta: "Talk about a pilot",
  },
] as const;

const pageCopy = {
  payg: {
    hero: "Need one output? Start here.",
    subhead: "Upload the brief, data, notes, and template. Basquio estimates the credits before you pay.",
    primary: "Estimate one output",
    support: "No subscription. No free trial pool. No workspace setup.",
  },
  workspace: {
    hero: "A workspace for recurring research work.",
    subhead:
      "Keep briefs, data, notes, templates, and past outputs in one place. Basquio remembers the context so the next deck, report, or Excel file starts closer to done.",
    primary: "Start Workspace Pro trial",
    support: "One user, private projects, included usage, and a card-required 7-day trial.",
  },
  team: {
    hero: "For teams that prepare research outputs every month.",
    subhead:
      "Basquio gives your team a shared workspace for briefs, data, notes, templates, prior reviews, and stakeholder context. Start with a pilot from 500 per month.",
    primary: "Talk about a team pilot",
    support: "Pilot setup covers first materials, templates, rules, first outputs, and fair-use limits.",
  },
  security: {
    hero: "Security details before you upload.",
    subhead:
      "Basquio handles real work files. The public site should state only what is true today and mark future controls as planned.",
    primary: "Start one output",
    support: "No customer data training. Tenant isolation. Encryption in transit and at rest. DPA available.",
  },
} as const;

const conversationModes = [
  {
    id: "one-output",
    label: "One output",
    title: "One brief. Three files.",
    instruction: "April category update",
    copy: "Estimate first. Prepare the pack. Keep the evidence visible.",
    inputs: ["Brief", "Tracker", "Old deck"],
    memory: ["Audience", "Thesis", "Format"],
    artifacts: ["Deck", "Report", "Excel"],
    evidence: ["Objective", "Source rows", "Template rules"],
    href: "/pay-as-you-go",
    cta: "Estimate one output",
  },
  {
    id: "workspace",
    label: "Recurring work",
    title: "The next ask starts warm.",
    instruction: "Same client. New month.",
    copy: "Past reviews, rules, notes, and templates stay in the room.",
    inputs: ["Briefs", "Notes", "Reviews"],
    memory: ["Client", "Brand", "Category"],
    artifacts: ["Saved context", "Reusable format", "Next output"],
    evidence: ["Brand rules", "Stakeholder asks", "Past reviews"],
    href: "/workspace-pro",
    cta: "See Workspace Pro",
  },
  {
    id: "team",
    label: "Team workspace",
    title: "One room for recurring output.",
    instruction: "Board update",
    copy: "Research, brand, category, and strategy work from the same context.",
    inputs: ["Projects", "Sources", "Transcripts"],
    memory: ["Roles", "Rules", "Approvals"],
    artifacts: ["Team workspace", "Pilot output", "Evidence pack"],
    evidence: ["Team roles", "Review trail", "Source package"],
    href: "/team-workspace",
    cta: "Open team path",
  },
] as const;

export function MarketingHome({ variant }: { variant: MarketingVariant }) {
  if (variant.key === "conversation") {
    return <ConversationHome variant={variant} />;
  }

  return (
    <main className="mv-shell">
      <Hero variant={variant} />
      <section className="mv-section mv-router" aria-labelledby="router-heading">
        <div className="mv-section-head">
          <p className="mv-kicker">Buyer routing</p>
          <h2 id="router-heading">{variant.routerHeading}</h2>
        </div>
        <div className="mv-route-list">
          {buyerRoutes.map((route) => (
            <Link href={route.href} className="mv-route-card" key={route.title}>
              <span>{route.marker}</span>
              <div>
                <h3>{route.title}</h3>
                <p>{route.copy}</p>
              </div>
              <strong>{route.cta}</strong>
            </Link>
          ))}
        </div>
      </section>

      <section className="mv-section mv-proof-band">
        <div className="mv-proof-copy">
          <p className="mv-kicker">The real bottleneck</p>
          <h2>{variant.painHeading}</h2>
          <p>{variant.painCopy}</p>
        </div>
        <ContextTrail />
      </section>

      <section className="mv-section mv-output-grid">
        <div className="mv-section-head">
          <p className="mv-kicker">Output package</p>
          <h2>{variant.outputHeading}</h2>
          <p>{variant.outputCopy}</p>
        </div>
        <OutputPackage />
      </section>

      <section className="mv-section mv-memory-section">
        <div className="mv-memory-panel">
          <div>
            <p className="mv-kicker">Workspace memory</p>
            <h2>{variant.workspaceHeading}</h2>
            <p>{variant.workspaceCopy}</p>
          </div>
          <div className="mv-memory-grid">
            {rememberedItems.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="mv-section mv-team-band">
        <div>
          <p className="mv-kicker">Team path</p>
          <h2>{variant.teamHeading}</h2>
          <p>{variant.teamCopy}</p>
        </div>
        <Link href="/team-workspace" className="mv-text-link">
          See Team Workspace
        </Link>
      </section>

      <section className="mv-section mv-pricing-preview">
        <div className="mv-section-head">
          <p className="mv-kicker">Pricing paths</p>
          <h2>{variant.pricingHeading}</h2>
          <p>{variant.pricingCopy}</p>
        </div>
        <PricingPathCards />
      </section>
    </main>
  );
}

function ConversationHome({ variant }: { variant: MarketingVariant }) {
  const [activeId, setActiveId] = useState<(typeof conversationModes)[number]["id"]>("one-output");
  const activeMode = conversationModes.find((mode) => mode.id === activeId) ?? conversationModes[0];

  return (
    <main className="mv-chat-shell">
      <section className="mv-chat-stage" aria-labelledby="conversation-hero">
        <div className="mv-chat-copy">
          <p className="mv-kicker">{variant.eyebrow}</p>
          <h1 id="conversation-hero">{variant.hero}</h1>
          <p>{variant.subhead}</p>
          <div className="mv-cta-row">
            <Link href="/pay-as-you-go" className="mv-button mv-button-primary">
              {variant.primaryCta}
            </Link>
            <Link href={variant.secondaryHref} className="mv-button mv-button-secondary">
              {variant.secondaryCta}
            </Link>
          </div>
          <div className="mv-chat-router" aria-label="Buyer paths">
            {[
              ["One output", "Estimate first", "/pay-as-you-go"],
              ["Workspace Pro", "Keep context", "/workspace-pro"],
              ["Team Workspace", "Share memory", "/team-workspace"],
            ].map(([title, detail, href]) => (
              <Link href={href} className="mv-chat-route" key={title}>
                <span>{title}</span>
                <strong>{detail}</strong>
              </Link>
            ))}
          </div>
        </div>

        <div className="mv-chat-room" aria-label={variant.visualTitle}>
          <div className="mv-chat-topbar">
            <span>{variant.visualTitle}</span>
            <strong>{activeMode.label}</strong>
          </div>
          <div className="mv-chat-prompts" aria-label="Buyer prompt modes">
            {conversationModes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                aria-pressed={mode.id === activeId}
                className={mode.id === activeId ? "mv-chat-prompt mv-chat-prompt-active" : "mv-chat-prompt"}
                onClick={() => setActiveId(mode.id)}
              >
                <span>{mode.label}</span>
              </button>
            ))}
          </div>
          <div className="mv-command-grid">
            <div className="mv-command-brief">
              <span>Clear direction</span>
              <h2>{activeMode.title}</h2>
              <p>{activeMode.instruction}</p>
            </div>

            <div className="mv-command-flow" aria-label="Basquio workflow">
              <div className="mv-command-column">
                <span>Inputs</span>
                <div className="mv-command-list">
                  {activeMode.inputs.map((item) => (
                    <b key={item}>{item}</b>
                  ))}
                </div>
              </div>
              <div className="mv-command-core">
                <span>Workspace memory</span>
                <p>{activeMode.copy}</p>
                <div className="mv-command-memory">
                  {activeMode.memory.map((item) => (
                    <b key={item}>{item}</b>
                  ))}
                </div>
              </div>
              <div className="mv-command-column">
                <span>Outputs</span>
                <div className="mv-command-list">
                  {activeMode.artifacts.map((item) => (
                    <b key={item}>{item}</b>
                  ))}
                </div>
              </div>
            </div>

            <aside className="mv-chat-evidence" aria-label="Evidence package">
              <span>Evidence trail</span>
              <div className="mv-chat-evidence-list">
                {activeMode.evidence.map((item, index) => (
                  <div className="mv-chat-evidence-item" key={item}>
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <Link href={activeMode.href} className="mv-chat-panel-link">
                {activeMode.cta}
              </Link>
            </aside>
          </div>
        </div>
      </section>

      <section className="mv-chat-answer-grid" aria-label="What Basquio does">
        {[
          ["For", "Market research teams."],
          ["Input", "Brief, data, notes, template, past work."],
          ["Output", "Deck, report, Excel file, evidence package."],
        ].map(([title, copy]) => (
          <article key={title}>
            <span>{title}</span>
            <p>{copy}</p>
          </article>
        ))}
      </section>

      <section className="mv-chat-band" aria-labelledby="conversation-bottleneck">
        <div>
          <p className="mv-kicker">Buyer truth</p>
          <h2 id="conversation-bottleneck">{variant.painHeading}</h2>
        </div>
        <p>{variant.painCopy}</p>
      </section>

      <section className="mv-chat-output" aria-labelledby="conversation-files">
        <div className="mv-section-head">
          <p className="mv-kicker">Output package</p>
          <h2 id="conversation-files">{variant.outputHeading}</h2>
          <p>{variant.outputCopy}</p>
        </div>
        <div className="mv-chat-output-grid">
          {[
            ["Deck", "Presentation-ready storyline and charts."],
            ["Report", "Written narrative for the decision."],
            ["Excel", "Workbook behind the numbers."],
            ["Evidence", "Sources behind the claims."],
          ].map(([title, copy]) => (
            <article className="mv-chat-output-card" key={title}>
              <span>{title}</span>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mv-chat-band mv-chat-band-inverse" aria-labelledby="conversation-team">
        <div>
          <p className="mv-kicker">Workspace path</p>
          <h2 id="conversation-team">{variant.teamHeading}</h2>
        </div>
        <div className="mv-chat-band-actions">
          <p>{variant.teamCopy}</p>
          <Link href="/team-workspace" className="mv-chat-panel-link">
            See Team Workspace
          </Link>
        </div>
      </section>
    </main>
  );
}

function Hero({ variant }: { variant: MarketingVariant }) {
  return (
    <section className="mv-hero">
      <div className="mv-hero-copy">
        <p className="mv-kicker">{variant.eyebrow}</p>
        <h1>{variant.hero}</h1>
        <p>{variant.subhead}</p>
        <div className="mv-cta-row">
          <Link href="/pay-as-you-go" className="mv-button mv-button-primary">
            {variant.primaryCta}
          </Link>
          <Link href={variant.secondaryHref} className="mv-button mv-button-secondary">
            {variant.secondaryCta}
          </Link>
        </div>
        <Link href="/security" className="mv-trust-link">
          Security and data handling
        </Link>
      </div>
      <HeroVisual variant={variant} />
    </section>
  );
}

function HeroVisual({ variant }: { variant: MarketingVariant }) {
  const [selected, setSelected] = useState("Brief");
  const [activeTab, setActiveTab] = useState<(typeof outputTabs)[number]["id"]>("deck");
  const labels = variant.visualMode === "italian" ? italianInputLabels : inputLabels;
  const activeOutput = outputTabs.find((tab) => tab.id === activeTab) ?? outputTabs[0];

  const workspaceLabels = useMemo(() => {
    if (variant.visualMode === "deadline") return ["Due tomorrow", "Changed brief", "Cost estimate", "Source check"];
    if (variant.visualMode === "team") return ["Brand rules", "Stakeholder asks", "Shared projects", "Past reviews"];
    if (variant.visualMode === "italian") return ["Contesto", "Template", "Review", "Output"];
    return ["Project context", "Brand rules", "Last review", "Template memory"];
  }, [variant.visualMode]);

  return (
    <div className="mv-visual" aria-label={variant.visualTitle}>
      <div className="mv-visual-header">
        <span>{variant.visualTitle}</span>
        <strong>{activeOutput.label}</strong>
      </div>
      <div className="mv-visual-body">
        <div className="mv-input-stack">
          {labels.map((label) => (
            <button
              key={label}
              type="button"
              className={selected === label ? "mv-input-chip mv-input-chip-active" : "mv-input-chip"}
              onClick={() => setSelected(label)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mv-workspace-core">
          <span className="mv-core-label">Basquio workspace</span>
          <h3>{selected}</h3>
          <div className="mv-core-grid">
            {workspaceLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </div>
        <div className="mv-output-preview">
          <div className="mv-output-tabs">
            {outputTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? "mv-output-tab mv-output-tab-active" : "mv-output-tab"}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="mv-artifact-card">
            <span>Prepared output</span>
            <h3>{activeOutput.title}</h3>
            <p>{activeOutput.detail}</p>
            <div className="mv-mini-chart" aria-hidden="true">
              <span style={{ height: "45%" }} />
              <span style={{ height: "68%" }} />
              <span style={{ height: "86%" }} />
              <span style={{ height: "58%" }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContextTrail() {
  const [active, setActive] = useState("Brief");
  const items = [
    ["Brief", "Audience, objective, thesis, and the decision the output supports."],
    ["Data", "Tables and workbook tabs that supply numbers and chart series."],
    ["Notes", "Meeting context, caveats, and working interpretation."],
    ["Template", "Approved format, brand rules, and slide patterns."],
    ["Review", "What stakeholders corrected, approved, or rejected last time."],
  ] as const;
  const activeItem = items.find(([label]) => label === active) ?? items[0];

  return (
    <div className="mv-trail">
      <div className="mv-trail-buttons">
        {items.map(([label]) => (
          <button
            key={label}
            type="button"
            className={label === active ? "mv-trail-button mv-trail-button-active" : "mv-trail-button"}
            onClick={() => setActive(label)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mv-trail-detail">
        <span>Stored context</span>
        <h3>{activeItem[0]}</h3>
        <p>{activeItem[1]}</p>
      </div>
    </div>
  );
}

function OutputPackage() {
  const files = [
    ["Deck", "Editable presentation with charts, storyline, recommendations, and source notes."],
    ["Report", "Written explanation of what changed, why it matters, and what to do next."],
    ["Excel", "Workbook with the tables behind the numbers and reviewable analysis tabs."],
  ] as const;
  return (
    <div className="mv-file-grid">
      {files.map(([title, copy]) => (
        <article key={title} className="mv-file-card">
          <div className="mv-file-top">
            <span>{title.slice(0, 2)}</span>
            <strong>{title}</strong>
          </div>
          <p>{copy}</p>
          <div className="mv-file-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </article>
      ))}
    </div>
  );
}

function PricingPathCards() {
  return (
    <div className="mv-price-grid">
      {pricingPaths.map((path) => (
        <article className="mv-price-card" key={path.name}>
          <p>{path.name}</p>
          <h3>{path.price}</h3>
          <span>{path.copy}</span>
          <Link href={path.href}>{path.cta}</Link>
        </article>
      ))}
    </div>
  );
}

export function MarketingPricingPage() {
  return (
    <main className="mv-shell mv-page">
      <SimpleHero
        kicker="Pricing"
        title="Choose how you want to use Basquio."
        copy="Pay for one output when the work is occasional. Use Workspace Pro or Team Workspace when the context needs to stay alive between outputs."
        cta="Start one output"
        href="/pay-as-you-go"
      />
      <section className="mv-section">
        <PricingPathCards />
      </section>
      <section className="mv-section mv-faq">
        <h2>Pricing questions</h2>
        <FaqRows
          rows={[
            ["Why no free plan?", "Basquio is built for real work with real files. Pay as you go lets you start with one output without subscribing."],
            ["Why estimate first?", "A short report and a full deck do not cost the same to produce. Basquio estimates the work from the files and brief before you buy credits."],
            ["What happens if a run fails?", "Credits are returned when Basquio fails to produce the promised output."],
            ["Is Team Workspace unlimited?", "It is designed for normal daily team usage. During pilot setup we agree fair-use limits based on team size and expected output volume."],
          ]}
        />
      </section>
    </main>
  );
}

export function MarketingDetailPage({ kind }: { kind: keyof typeof pageCopy }) {
  const copy = pageCopy[kind];
  const heroHref =
    kind === "team"
      ? "mailto:marco@basquio.com?subject=Team%20Workspace%20pilot"
      : kind === "workspace"
        ? "/sign-in?mode=sign-up"
        : kind === "security"
          ? "/pay-as-you-go"
          : "/jobs/new";
  const sections =
    kind === "security"
      ? [
          ["Data use", "No model training on customer data."],
          ["Access", "Workspace-level tenant isolation and scoped access."],
          ["Protection", "Encryption in transit and at rest."],
          ["Governance", "DPA available. SOC 2 Type 1 is planned, not claimed."],
        ]
      : kind === "team"
        ? [
            ["Setup", "Configure first projects, templates, stakeholder context, and rules."],
            ["First outputs", "Run a real deck, report, and workbook through the pilot."],
            ["Shared memory", "Keep approved context available to the team."],
            ["Fair use", "Agree normal usage and limits before the pilot becomes monthly."],
          ]
        : kind === "workspace"
          ? [
              ["Projects", "Keep recurring clients, categories, and workstreams together."],
              ["Memory", "Save notes, templates, past reviews, and accepted preferences."],
              ["Outputs", "Produce decks, reports, and workbooks from the workspace context."],
              ["Trial", "Card required. Billing starts after seven days."],
            ]
          : [
              ["Upload", "Bring the brief, data, notes, and optional template."],
              ["Estimate", "Review the credit estimate before you pay."],
              ["Run", "Basquio prepares the deck, report, and Excel file."],
              ["Review", "Open the files and inspect the evidence trail."],
            ];

  return (
    <main className="mv-shell mv-page">
      <SimpleHero kicker="Basquio" title={copy.hero} copy={copy.subhead} cta={copy.primary} href={heroHref} />
      <section className="mv-section mv-detail-grid">
        {sections.map(([title, detail]) => (
          <article key={title} className="mv-detail-card">
            <span>{title}</span>
            <p>{detail}</p>
          </article>
        ))}
      </section>
      <section className="mv-section mv-note-band">
        <p>{copy.support}</p>
      </section>
    </main>
  );
}

export function MarketingComparePage() {
  const rows = [
    ["Manual workflow", "Context lives across files, meetings, email, and last year's deck."],
    ["Generic chat", "Can answer questions, but does not own the output package or workspace memory."],
    ["Slide tools", "Help produce slides, but do not keep research context or audit workbook lineage."],
    ["Knowledge portals", "Store documents, but do not turn the next brief into finished files."],
    ["Basquio", "Keeps the research context and prepares the deck, report, and Excel file."],
  ] as const;

  return (
    <main className="mv-shell mv-page">
      <SimpleHero
        kicker="Compare"
        title="Basquio is not a chat box, a slide tool, or a file library."
        copy="It is the workspace and output engine for recurring research work."
        cta="Start one output"
        href="/pay-as-you-go"
      />
      <section className="mv-section mv-compare-list">
        {rows.map(([title, copy]) => (
          <article key={title}>
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

function SimpleHero({
  kicker,
  title,
  copy,
  cta,
  href,
}: {
  kicker: string;
  title: string;
  copy: string;
  cta: string;
  href: string;
}) {
  return (
    <section className="mv-simple-hero">
      <p className="mv-kicker">{kicker}</p>
      <h1>{title}</h1>
      <p>{copy}</p>
      <Link href={href} className="mv-button mv-button-primary">
        {cta}
      </Link>
    </section>
  );
}

function FaqRows({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <div className="mv-faq-list">
      {rows.map(([question, answer]) => (
        <details key={question}>
          <summary>{question}</summary>
          <p>{answer}</p>
        </details>
      ))}
    </div>
  );
}
