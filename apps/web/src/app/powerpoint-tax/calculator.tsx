"use client";

import { Info, Link as LinkIcon, LinkedinLogo, XLogo } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect, useId, useRef, useState } from "react";

type CalculatorInputs = {
  decksPerMonth: number;
  avgSlides: number;
  hoursPerDeck: number;
  hourlyRate: number;
};

type RawCalculatorInputs = {
  [K in keyof CalculatorInputs]: string;
};

type CalculatorResult = {
  totalHoursPerYear: number;
  totalCostPerYear: number;
  totalWeeksPerYear: number;
  hoursSaved: number;
  dollarsSaved: number;
  weeksSaved: number;
  decksPerYear: number;
  slidesPerYear: number;
};

type InputConfig = {
  key: keyof CalculatorInputs;
  label: string;
  tooltip: string;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
  integer?: boolean;
};

type SearchParamsLike = Pick<URLSearchParams, "get" | "has" | "toString">;

type PowerPointTaxCalculatorProps = {
  initialQuery?: Partial<Record<"d" | "s" | "h" | "r", string>>;
};

const DEFAULT_INPUTS: CalculatorInputs = {
  decksPerMonth: 4,
  avgSlides: 15,
  hoursPerDeck: 12,
  hourlyRate: 75,
};

const INPUT_CONFIG: InputConfig[] = [
  {
    key: "decksPerMonth",
    label: "Decks per month",
    tooltip:
      "Monthly category reviews, QBRs, client reports, board decks — count all recurring data-driven decks.",
    min: 1,
    max: 100,
    step: 1,
    integer: true,
  },
  {
    key: "avgSlides",
    label: "Avg slides per deck",
    tooltip: "A typical category review is 10-20 slides. A QBR is 15-30.",
    min: 1,
    max: 100,
    step: 1,
    integer: true,
  },
  {
    key: "hoursPerDeck",
    label: "Hours per deck",
    tooltip:
      "Include data prep, chart building, formatting, review cycles. Most analysts underestimate by 40%.",
    min: 1,
    max: 100,
    step: 0.5,
  },
  {
    key: "hourlyRate",
    label: "Your hourly rate",
    tooltip:
      "Loaded cost, not take-home. Includes benefits, overhead. $50-75 for analysts, $100-200 for consultants, $200-500 for partners.",
    min: 1,
    max: 1000,
    step: 1,
    prefix: "$",
  },
];

const SAVINGS_RATE = 0.7;
const DEBOUNCE_MS = 150;
const BASE_URL = "https://basquio.com/powerpoint-tax";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundToNearest(value: number, increment: number) {
  return Math.round(value / increment) * increment;
}

function isDefaultScenario(inputs: CalculatorInputs) {
  return (
    inputs.decksPerMonth === DEFAULT_INPUTS.decksPerMonth &&
    inputs.avgSlides === DEFAULT_INPUTS.avgSlides &&
    inputs.hoursPerDeck === DEFAULT_INPUTS.hoursPerDeck &&
    inputs.hourlyRate === DEFAULT_INPUTS.hourlyRate
  );
}

function parseNumber(value: string) {
  const normalized = value.replace(/[^0-9.]/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInitialInputs(searchParams: SearchParamsLike): CalculatorInputs {
  return {
    decksPerMonth: clamp(Number.parseInt(searchParams.get("d") ?? "", 10) || DEFAULT_INPUTS.decksPerMonth, 1, 100),
    avgSlides: clamp(Number.parseInt(searchParams.get("s") ?? "", 10) || DEFAULT_INPUTS.avgSlides, 1, 100),
    hoursPerDeck: clamp(parseNumber(searchParams.get("h") ?? "") ?? DEFAULT_INPUTS.hoursPerDeck, 1, 100),
    hourlyRate: clamp(parseNumber(searchParams.get("r") ?? "") ?? DEFAULT_INPUTS.hourlyRate, 1, 1000),
  };
}

function createSearchParamsLike(initialQuery?: Partial<Record<"d" | "s" | "h" | "r", string>>): SearchParamsLike {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(initialQuery ?? {})) {
    if (typeof value === "string" && value.length > 0) {
      params.set(key, value);
    }
  }

  return params;
}

function toRawInputs(inputs: CalculatorInputs): RawCalculatorInputs {
  return {
    decksPerMonth: String(inputs.decksPerMonth),
    avgSlides: String(inputs.avgSlides),
    hoursPerDeck: String(inputs.hoursPerDeck),
    hourlyRate: String(inputs.hourlyRate),
  };
}

function commitRawInputs(rawInputs: RawCalculatorInputs, previous: CalculatorInputs): CalculatorInputs {
  return INPUT_CONFIG.reduce<CalculatorInputs>((next, field) => {
    const parsed = parseNumber(rawInputs[field.key]);
    if (parsed === null) {
      next[field.key] = previous[field.key];
      return next;
    }

    const constrained = clamp(parsed, field.min, field.max);
    next[field.key] = field.integer ? Math.round(constrained) : constrained;
    return next;
  }, { ...previous });
}

function buildShareUrl(inputs: CalculatorInputs) {
  const params = new URLSearchParams({
    d: String(inputs.decksPerMonth),
    s: String(inputs.avgSlides),
    h: String(inputs.hoursPerDeck),
    r: String(inputs.hourlyRate),
  });

  return `${BASE_URL}?${params.toString()}`;
}

function formatWeeksForShare(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function computePowerPointTax(inputs: CalculatorInputs): CalculatorResult {
  const decksPerYear = inputs.decksPerMonth * 12;
  const slidesPerYear = decksPerYear * inputs.avgSlides;
  const rawTotalHours = decksPerYear * inputs.hoursPerDeck;
  const totalHoursPerYear = isDefaultScenario(inputs) ? roundToNearest(rawTotalHours, 10) : Math.round(rawTotalHours);
  const totalCostPerYear = roundToNearest(totalHoursPerYear * inputs.hourlyRate, 50);
  const totalWeeksPerYear = +(totalHoursPerYear / 40).toFixed(1);

  const hoursSaved = Math.round(totalHoursPerYear * SAVINGS_RATE);
  const dollarsSaved = roundToNearest(totalCostPerYear * SAVINGS_RATE, 50);
  const weeksSaved = +(totalWeeksPerYear * SAVINGS_RATE).toFixed(1);

  return {
    totalHoursPerYear,
    totalCostPerYear,
    totalWeeksPerYear,
    hoursSaved,
    dollarsSaved,
    weeksSaved,
    decksPerYear,
    slidesPerYear,
  };
}

function ValueSwap({ value, className }: { value: string; className?: string }) {
  return (
    <span key={value} className={className ? `${className} power-tax-value-swap` : "power-tax-value-swap"}>
      {value}
    </span>
  );
}

function Tooltip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <span
      className={`power-tax-tooltip${open ? " power-tax-tooltip-open" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="power-tax-tooltip-trigger"
        aria-label={`More detail about ${label}`}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onClick={() => setOpen((current) => !current)}
        onBlur={() => setOpen(false)}
      >
        <Info size={14} weight="bold" />
      </button>
      <span id={tooltipId} role="tooltip" className="power-tax-tooltip-bubble">
        {text}
      </span>
    </span>
  );
}

export function PowerPointTaxCalculator({ initialQuery }: PowerPointTaxCalculatorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const initialInputsRef = useRef<CalculatorInputs>(parseInitialInputs(createSearchParamsLike(initialQuery)));
  const [rawInputs, setRawInputs] = useState<RawCalculatorInputs>(() => toRawInputs(initialInputsRef.current));
  const [inputs, setInputs] = useState<CalculatorInputs>(initialInputsRef.current);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const numberFormat = useRef(new Intl.NumberFormat()).current;
  const currencyFormat = useRef(
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }),
  ).current;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setInputs((previous) => commitRawInputs(rawInputs, previous));
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [rawInputs]);

  useEffect(() => {
    const params = new URLSearchParams();
    const urlShouldCarryState =
      inputs.decksPerMonth !== DEFAULT_INPUTS.decksPerMonth ||
      inputs.avgSlides !== DEFAULT_INPUTS.avgSlides ||
      inputs.hoursPerDeck !== DEFAULT_INPUTS.hoursPerDeck ||
      inputs.hourlyRate !== DEFAULT_INPUTS.hourlyRate;

    if (urlShouldCarryState) {
      params.set("d", String(inputs.decksPerMonth));
      params.set("s", String(inputs.avgSlides));
      params.set("h", String(inputs.hoursPerDeck));
      params.set("r", String(inputs.hourlyRate));
    }

    const next = params.toString();
    const current = typeof window === "undefined" ? "" : window.location.search.replace(/^\?/, "");
    if (next === current) {
      return;
    }

    startTransition(() => {
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    });
  }, [inputs, pathname, router]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const results = computePowerPointTax(inputs);
  const shareUrl = buildShareUrl(inputs);
  const shareText = `My PowerPoint Tax: ${numberFormat.format(results.totalHoursPerYear)} hours lost last year. That's ${formatWeeksForShare(results.totalWeeksPerYear)} work weeks. What's yours? ${shareUrl}`;

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function updateRawInput(field: keyof CalculatorInputs, value: string) {
    setRawInputs((current) => ({
      ...current,
      [field]: value,
    }));
  }

  const summaryTiles = [
    { value: numberFormat.format(results.totalHoursPerYear), label: "Hours", meta: "/ year", accent: false },
    { value: currencyFormat.format(results.totalCostPerYear), label: "Dollars", meta: "/ year", accent: false },
    { value: formatWeeksForShare(results.totalWeeksPerYear), label: "Weeks", meta: "/ year", accent: false },
  ] as const;

  const savingsTiles = [
    { value: numberFormat.format(results.hoursSaved), label: "Hours", meta: "saved" },
    { value: currencyFormat.format(results.dollarsSaved), label: "Dollars", meta: "saved" },
    { value: formatWeeksForShare(results.weeksSaved), label: "Weeks", meta: "reclaimed" },
  ] as const;

  return (
    <>
      <section className="hero-stage power-tax-hero">
        <div className="power-tax-hero-copy">
          <div className="stack power-tax-hero-head">
            <p className="section-label light">The PowerPoint Tax</p>
            <h1>
              You lost <ValueSwap value={formatWeeksForShare(results.totalWeeksPerYear)} className="power-tax-inline-hero-number power-tax-inline-hero-number-time" /> work
              weeks to manual decks last year.
            </h1>
            <p className="hero-copy">
              If your team rebuilds the same charts and pages every month, this is what that work costs.
            </p>
          </div>

          <div className="power-tax-hero-metrics" aria-label="PowerPoint tax summary">
            <article className="power-tax-hero-metric">
              <p className="power-tax-hero-metric-label">Hours lost</p>
              <p className="power-tax-hero-metric-value power-tax-hero-metric-value-time">
                <ValueSwap value={numberFormat.format(results.totalHoursPerYear)} />
              </p>
            </article>
            <article className="power-tax-hero-metric">
              <p className="power-tax-hero-metric-label">Cost lost</p>
              <p className="power-tax-hero-metric-value power-tax-hero-metric-value-money">
                <ValueSwap value={currencyFormat.format(results.totalCostPerYear)} />
              </p>
            </article>
            <article className="power-tax-hero-metric">
              <p className="power-tax-hero-metric-label">Work weeks</p>
              <p className="power-tax-hero-metric-value">
                <ValueSwap value={formatWeeksForShare(results.totalWeeksPerYear)} />
              </p>
            </article>
          </div>

          <a href="#calculator" className="power-tax-scroll-link">
            Calculate your number
          </a>
        </div>

        <div className="power-tax-hero-side">
          <div className="power-tax-hero-note">
            <p className="power-tax-side-label">Smart defaults</p>
            <p className="power-tax-side-copy">
              We loaded a typical analyst setup: {DEFAULT_INPUTS.decksPerMonth} decks a month, {DEFAULT_INPUTS.avgSlides} slides per deck, {DEFAULT_INPUTS.hoursPerDeck} hours per deck, {currencyFormat.format(DEFAULT_INPUTS.hourlyRate)} per hour.
            </p>
          </div>
          <div className="power-tax-hero-note">
            <p className="power-tax-side-label">What changes the number</p>
            <p className="power-tax-side-copy">
              At this workload, your team is building {numberFormat.format(results.slidesPerYear)} slides a year. The number rises fast once decks become routine.
            </p>
          </div>
        </div>
      </section>

      <section id="calculator" className="panel power-tax-calculator-panel">
        <div className="stack">
          <p className="section-label">Your numbers</p>
          <h2>Adjust the four inputs that drive the tax.</h2>
          <p className="page-copy">Use your real numbers. The total updates as you type.</p>
        </div>

        <div className="power-tax-input-grid">
          {INPUT_CONFIG.map((field) => (
            <label key={field.key} className="field power-tax-field">
              <span className="power-tax-field-label-row">
                <span>{field.label}</span>
                <Tooltip label={field.label} text={field.tooltip} />
              </span>
              <div className={field.prefix ? "power-tax-input-wrap power-tax-input-wrap-prefixed" : "power-tax-input-wrap"}>
                {field.prefix ? <span className="power-tax-input-prefix">{field.prefix}</span> : null}
                <input
                  inputMode="decimal"
                  min={field.min}
                  max={field.max}
                  step={field.step ?? 1}
                  type="number"
                  value={rawInputs[field.key]}
                  onChange={(event) => updateRawInput(field.key, event.target.value)}
                  aria-describedby={`${field.key}-hint`}
                />
              </div>
              <small id={`${field.key}-hint`}>{field.tooltip}</small>
            </label>
          ))}
        </div>
      </section>

      <section className="panel power-tax-results-panel">
        <div className="stack">
          <p className="section-label">Your PowerPoint tax</p>
          <h2>
            {numberFormat.format(results.decksPerYear)} decks a year adds up to {numberFormat.format(results.slidesPerYear)} slides your team has to make.
          </h2>
        </div>

        <div className="power-tax-results-stack">
          <div className="power-tax-results-group">
            <div className="power-tax-results-heading">
              <div className="power-tax-results-heading-copy">
                <strong>Current cost</strong>
                <span>{numberFormat.format(results.totalHoursPerYear)} hours spent making the deck, not doing the analysis.</span>
              </div>
              <p className="power-tax-results-heading-stat">What it costs now</p>
            </div>
            <div className="power-tax-card-grid">
              {summaryTiles.map((tile) => (
                <article key={tile.label} className="power-tax-result-card">
                  <p className="power-tax-result-value">
                    <ValueSwap value={tile.value} />
                  </p>
                  <p className="power-tax-result-label">{tile.label}</p>
                  <p className="power-tax-result-meta">{tile.meta}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="power-tax-savings-copy">
            <p>
              Most of that time is charting, formatting, and version cleanup. That is the part Basquio cuts.
            </p>
          </div>

          <div className="power-tax-results-group">
            <div className="power-tax-results-heading">
              <div className="power-tax-results-heading-copy">
                <strong>What Basquio gives back</strong>
                <span>Based on the time spent getting the deck built.</span>
              </div>
              <p className="power-tax-results-heading-stat power-tax-results-heading-stat-accent">What you get back</p>
            </div>
            <div className="power-tax-card-grid">
              {savingsTiles.map((tile) => (
                <article key={tile.label} className="power-tax-result-card power-tax-result-card-savings">
                  <p className="power-tax-result-value">
                    <ValueSwap value={tile.value} />
                  </p>
                  <p className="power-tax-result-label">{tile.label}</p>
                  <p className="power-tax-result-meta">{tile.meta}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="inset-panel power-tax-context-strip">
        <article className="power-tax-context-item">
          <p className="power-tax-context-kicker">What people say</p>
          <p>55% of professionals say making slides is not a good use of their time.</p>
          <span>24slides survey, about 1,000 marketing professionals</span>
        </article>
        <article className="power-tax-context-item">
          <p className="power-tax-context-kicker">Industry average</p>
          <p>The average knowledge worker spends 4.87 hours per week on presentation design.</p>
          <span>24slides industry benchmark</span>
        </article>
        <article className="power-tax-context-item">
          <p className="power-tax-context-kicker">What we see</p>
          <p>In the decks we study, most of the time goes to charting, formatting, and version cleanup.</p>
          <span>Basquio analysis of 40+ internal deck builds</span>
        </article>
      </section>

      <section className="panel power-tax-share-panel">
        <div className="power-tax-share-grid">
          <div className="stack">
            <p className="section-label">Share your number</p>
            <h2>My PowerPoint Tax: {numberFormat.format(results.totalHoursPerYear)} hours lost last year.</h2>
            <p className="page-copy">That is {formatWeeksForShare(results.totalWeeksPerYear)} work weeks spent making decks.</p>
            <p className="power-tax-share-quote">Share it with the team. The link keeps the numbers exactly as you set them.</p>
            <div className="row power-tax-share-actions">
              <a
                className="button secondary"
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noreferrer"
              >
                <XLogo size={18} weight="fill" />
                Share on X
              </a>
              <a
                className="button secondary"
                href={`https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noreferrer"
              >
                <LinkedinLogo size={18} weight="fill" />
                Share on LinkedIn
              </a>
              <button type="button" className="button secondary" onClick={handleCopyLink}>
                <LinkIcon size={18} weight="bold" />
                Copy link
              </button>
            </div>
            <p className={`power-tax-copy-toast${copied ? " power-tax-copy-toast-visible" : ""}`}>Copied!</p>
          </div>

          <div className="power-tax-cta-block">
            <div className="stack">
              <p className="section-label">Stop paying the tax</p>
              <h3>Bring the files behind the next review.</h3>
              <p className="muted">
                Basquio turns them into charts, pages, and a first draft deck your team can review and edit.
              </p>
            </div>
            <div className="power-tax-cta-proof-row">
              <div className="power-tax-cta-proof-pill">
                <strong>{numberFormat.format(results.hoursSaved)}</strong>
                <span>hours back</span>
              </div>
              <div className="power-tax-cta-proof-pill">
                <strong>{formatWeeksForShare(results.weeksSaved)}</strong>
                <span>weeks reclaimed</span>
              </div>
            </div>
            <div className="row">
              <Link className="button" href="/jobs/new">
                Try Basquio free
              </Link>
              <Link className="button secondary" href="/pricing">
                See pricing
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
