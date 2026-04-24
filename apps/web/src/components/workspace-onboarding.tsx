"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Buildings,
  Check,
  Plus,
  UsersThree,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

import { WorkspaceUploadZone } from "@/components/workspace-upload-zone";
import { SUPPORTED_UPLOAD_LABEL } from "@/lib/workspace/constants";

type OnboardingStep = 1 | 2 | 3;
type ScopeKind = "client" | "category" | "function";

type ScopeInput = {
  id: string;
  kind: ScopeKind;
  name: string;
};

type StakeholderInput = {
  id: string;
  scopeKey: string;
  name: string;
  role: string;
  preference: string;
};

type DraftState = {
  scopes: ScopeInput[];
  stakeholders: StakeholderInput[];
};

const DRAFT_KEY = "basquio:workspace-onboarding-draft";

const SCOPE_KIND_META: Record<ScopeKind, { label: string; icon: typeof Buildings; placeholder: string; hint: string }> = {
  client: {
    label: "Client",
    icon: Buildings,
    placeholder: "e.g., Mulino Bianco",
    hint: "A client, retailer, or business unit you answer questions for.",
  },
  category: {
    label: "Category",
    icon: Briefcase,
    placeholder: "e.g., Snack Salati",
    hint: "A category, segment, or market you keep tracking.",
  },
  function: {
    label: "Function",
    icon: UsersThree,
    placeholder: "e.g., Trade marketing",
    hint: "A team or workstream with its own operating rules.",
  },
};

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function defaultDraft(): DraftState {
  return {
    scopes: [{ id: uid(), kind: "client", name: "" }],
    stakeholders: [],
  };
}

function readDraft(): DraftState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    return {
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes : defaultDraft().scopes,
      stakeholders: Array.isArray(parsed.stakeholders) ? parsed.stakeholders : [],
    };
  } catch {
    return null;
  }
}

export function WorkspaceOnboarding({
  initialStep = 1,
  routed = false,
}: {
  initialStep?: OnboardingStep;
  routed?: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [scopes, setScopes] = useState<ScopeInput[]>(() => defaultDraft().scopes);
  const [stakeholders, setStakeholders] = useState<StakeholderInput[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStep(initialStep);
  }, [initialStep]);

  useEffect(() => {
    const draft = readDraft();
    if (draft) {
      setScopes(draft.scopes.length > 0 ? draft.scopes : defaultDraft().scopes);
      setStakeholders(draft.stakeholders);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ scopes, stakeholders }));
  }, [hydrated, scopes, stakeholders]);

  const namedScopes = useMemo(
    () => scopes.filter((scope) => scope.name.trim().length > 0),
    [scopes],
  );

  const canContinueStep1 = namedScopes.length > 0;

  function goTo(nextStep: OnboardingStep) {
    setStep(nextStep);
    if (routed) {
      router.push(`/onboarding/${nextStep}`);
    }
  }

  function addScope(kind: ScopeKind) {
    setScopes((prev) => [...prev, { id: uid(), kind, name: "" }]);
  }

  function updateScope(id: string, name: string) {
    setScopes((prev) => prev.map((scope) => (scope.id === id ? { ...scope, name } : scope)));
  }

  function removeScope(id: string) {
    const removedScope = scopes.find((scope) => scope.id === id);
    setScopes((prev) => prev.filter((scope) => scope.id !== id));
    if (removedScope) {
      const removedKey = `${removedScope.kind}:${slugify(removedScope.name)}`;
      setStakeholders((prev) => prev.filter((person) => person.scopeKey !== removedKey));
    }
  }

  function addStakeholder(scopeKey: string) {
    setStakeholders((prev) => [
      ...prev,
      { id: uid(), scopeKey, name: "", role: "", preference: "" },
    ]);
  }

  function updateStakeholder(id: string, patch: Partial<StakeholderInput>) {
    setStakeholders((prev) =>
      prev.map((person) => (person.id === id ? { ...person, ...patch } : person)),
    );
  }

  function removeStakeholder(id: string) {
    setStakeholders((prev) => prev.filter((person) => person.id !== id));
  }

  async function submit(skipped: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const scopePayload = namedScopes.map((scope) => ({
        kind: scope.kind,
        name: scope.name.trim(),
      }));
      const stakeholderPayload = stakeholders
        .filter((person) => person.name.trim().length > 0)
        .map((person) => {
          const [kind, slug] = person.scopeKey.split(":");
          return {
            scope_kind: kind as ScopeKind,
            scope_slug: slug,
            name: person.name.trim(),
            role: person.role.trim() || undefined,
            preference: person.preference.trim() || undefined,
          };
        });

      const response = await fetch("/api/workspace/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "other",
          role_other: "Workspace setup",
          scopes: skipped ? [] : scopePayload,
          stakeholders: skipped ? [] : stakeholderPayload,
          skipped,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        first_scope?: { kind: ScopeKind; slug: string } | null;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not complete onboarding.");
      }
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(DRAFT_KEY);
      }
      if (!skipped && body.first_scope) {
        router.push(`/workspace/scope/${body.first_scope.kind}/${body.first_scope.slug}`);
      } else {
        router.push("/workspace");
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete onboarding.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wbeta-onboard">
      <header className="wbeta-onboard-head">
        <p className="wbeta-onboard-eyebrow">Set up your workspace</p>
        <h1 className="wbeta-onboard-title">Basquio gets useful when it knows the work.</h1>
        <p className="wbeta-onboard-lede">
          Three small inputs create the base layer: the scopes you analyze, one real file, and one
          stakeholder Basquio should write for.
        </p>
      </header>

      <ol className="wbeta-onboard-stepper" aria-label="Onboarding progress">
        {([1, 2, 3] as OnboardingStep[]).map((item) => (
          <li
            key={item}
            className={
              item < step
                ? "wbeta-onboard-step wbeta-onboard-step-done"
                : item === step
                  ? "wbeta-onboard-step wbeta-onboard-step-active"
                  : "wbeta-onboard-step"
            }
            aria-current={item === step ? "step" : undefined}
          >
            <span className="wbeta-onboard-step-num">
              {item < step ? <Check size={12} weight="bold" /> : item}
            </span>
            <span className="wbeta-onboard-step-label">
              {item === 1 ? "Scopes" : item === 2 ? "Seed file" : "Stakeholder"}
            </span>
          </li>
        ))}
      </ol>

      {error ? (
        <div className="wbeta-onboard-error" role="alert">
          <WarningCircle size={13} weight="fill" /> {error}
        </div>
      ) : null}

      {step === 1 ? (
        <section className="wbeta-onboard-panel" aria-labelledby="onboard-scopes-title">
          <p className="wbeta-onboard-step-count">Step 1 of 3</p>
          <h2 id="onboard-scopes-title" className="wbeta-onboard-step-title">
            What do you analyze?
          </h2>
          <p className="wbeta-onboard-step-hint">
            Name one client, category, or function. You can add more later from the sidebar.
          </p>
          <div className="wbeta-onboard-scope-list">
            {scopes.map((scope) => {
              const Icon = SCOPE_KIND_META[scope.kind].icon;
              return (
                <div key={scope.id} className="wbeta-onboard-scope-row">
                  <span className="wbeta-onboard-scope-kind">
                    <Icon size={13} weight="regular" /> {SCOPE_KIND_META[scope.kind].label}
                  </span>
                  <input
                    type="text"
                    value={scope.name}
                    placeholder={SCOPE_KIND_META[scope.kind].placeholder}
                    onChange={(event) => updateScope(scope.id, event.target.value)}
                    maxLength={120}
                    aria-label={`${SCOPE_KIND_META[scope.kind].label} name`}
                  />
                  <button
                    type="button"
                    className="wbeta-onboard-scope-remove"
                    onClick={() => removeScope(scope.id)}
                    aria-label="Remove this scope"
                  >
                    <X size={13} weight="bold" />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="wbeta-onboard-add-row">
            {(Object.keys(SCOPE_KIND_META) as ScopeKind[]).map((kind) => {
              const Icon = SCOPE_KIND_META[kind].icon;
              return (
                <button
                  key={kind}
                  type="button"
                  className="wbeta-onboard-kind-card"
                  onClick={() => addScope(kind)}
                >
                  <Icon size={16} weight="regular" />
                  <span>
                    <strong>{SCOPE_KIND_META[kind].label}</strong>
                    {SCOPE_KIND_META[kind].hint}
                  </span>
                  <Plus size={12} weight="bold" />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="wbeta-onboard-panel" aria-labelledby="onboard-file-title">
          <p className="wbeta-onboard-step-count">Step 2 of 3</p>
          <h2 id="onboard-file-title" className="wbeta-onboard-step-title">
            Drop one thing that represents your work.
          </h2>
          <p className="wbeta-onboard-step-hint">
            An old deck, category brief, NIQ export, transcript, or markdown note is enough.
            Basquio will read it in the background and start building workspace memory.
          </p>
          <WorkspaceUploadZone supportedLabel={SUPPORTED_UPLOAD_LABEL} variant="hero" />
          <p className="wbeta-onboard-help">
            You can continue while parsing runs. Upload failures stay inline with retry paths.
          </p>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="wbeta-onboard-panel" aria-labelledby="onboard-stakeholder-title">
          <p className="wbeta-onboard-step-count">Step 3 of 3</p>
          <h2 id="onboard-stakeholder-title" className="wbeta-onboard-step-title">
            Who do you write for?
          </h2>
          <p className="wbeta-onboard-step-hint">
            Add one stakeholder so Basquio can tune brief depth, charts, and tone to the reader.
          </p>
          {namedScopes.length === 0 ? (
            <p className="wbeta-onboard-empty">
              Go back to step 1 to add a scope first, or skip this setup and teach Basquio in chat.
            </p>
          ) : (
            <div className="wbeta-onboard-stakeholders">
              {namedScopes.map((scope) => {
                const Icon = SCOPE_KIND_META[scope.kind].icon;
                const scopeKey = `${scope.kind}:${slugify(scope.name)}`;
                const rows = stakeholders.filter((person) => person.scopeKey === scopeKey);
                return (
                  <div key={scope.id} className="wbeta-onboard-stakeholder-group">
                    <header className="wbeta-onboard-stakeholder-head">
                      <Icon size={14} weight="regular" />
                      <h3 className="wbeta-onboard-stakeholder-title">{scope.name}</h3>
                      <span className="wbeta-onboard-stakeholder-kind">
                        {SCOPE_KIND_META[scope.kind].label}
                      </span>
                    </header>
                    {rows.length === 0 ? (
                      <p className="wbeta-onboard-empty-small">
                        Tell the chat later, or add one person now.
                      </p>
                    ) : (
                      rows.map((row) => (
                        <div key={row.id} className="wbeta-onboard-stakeholder-row">
                          <label className="wbeta-onboard-field">
                            <span>Name</span>
                            <input
                              type="text"
                              value={row.name}
                              onChange={(event) =>
                                updateStakeholder(row.id, { name: event.target.value })
                              }
                              placeholder="e.g., Elena Bianchi"
                              maxLength={200}
                            />
                          </label>
                          <label className="wbeta-onboard-field">
                            <span>Role</span>
                            <input
                              type="text"
                              value={row.role}
                              onChange={(event) =>
                                updateStakeholder(row.id, { role: event.target.value })
                              }
                              placeholder="e.g., Head of Category"
                              maxLength={200}
                            />
                          </label>
                          <label className="wbeta-onboard-field wbeta-onboard-field-wide">
                            <span>They prefer</span>
                            <input
                              type="text"
                              value={row.preference}
                              onChange={(event) =>
                                updateStakeholder(row.id, { preference: event.target.value })
                              }
                              placeholder="e.g., prefers 52-week reads and waterfall charts"
                              maxLength={600}
                            />
                          </label>
                          <button
                            type="button"
                            className="wbeta-onboard-scope-remove"
                            onClick={() => removeStakeholder(row.id)}
                            aria-label="Remove this stakeholder"
                          >
                            <X size={13} weight="bold" />
                          </button>
                        </div>
                      ))
                    )}
                    <button
                      type="button"
                      className="wbeta-onboard-add-btn"
                      onClick={() => addStakeholder(scopeKey)}
                    >
                      <Plus size={12} weight="bold" /> Add stakeholder
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      <footer className="wbeta-onboard-foot">
        <button
          type="button"
          className="wbeta-onboard-skip"
          onClick={() => submit(true)}
          disabled={busy}
        >
          Skip setup
        </button>
        <div className="wbeta-onboard-nav">
          {step > 1 ? (
            <button
              type="button"
              className="wbeta-onboard-back"
              onClick={() => goTo((step - 1) as OnboardingStep)}
              disabled={busy}
            >
              <ArrowLeft size={13} weight="bold" /> Back
            </button>
          ) : null}
          {step < 3 ? (
            <button
              type="button"
              className="wbeta-onboard-next"
              onClick={() => goTo((step + 1) as OnboardingStep)}
              disabled={busy || (step === 1 && !canContinueStep1)}
            >
              {step === 2 ? "Continue without waiting" : "Continue"}
              <ArrowRight size={13} weight="bold" />
            </button>
          ) : (
            <button
              type="button"
              className="wbeta-onboard-finish"
              onClick={() => submit(false)}
              disabled={busy}
            >
              {busy ? "Finishing" : "Finish setup"}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
