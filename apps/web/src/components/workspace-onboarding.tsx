"use client";

import { useMemo, useState } from "react";
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

type Role = "analyst" | "consultant" | "trade_marketing" | "other";
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

const ROLE_OPTIONS: Array<{ value: Role; label: string; hint: string }> = [
  {
    value: "analyst",
    label: "Internal analyst",
    hint: "Category, brand, or insights team inside a CPG company.",
  },
  {
    value: "consultant",
    label: "Agency consultant",
    hint: "You answer CPG questions for multiple clients on retainer.",
  },
  {
    value: "trade_marketing",
    label: "Trade marketing",
    hint: "You build decks for account, retailer, and distributor conversations.",
  },
  {
    value: "other",
    label: "Something else",
    hint: "Tell us in one line.",
  },
];

const SCOPE_KIND_META: Record<ScopeKind, { label: string; icon: typeof Buildings; placeholder: string }> = {
  client: { label: "Client", icon: Buildings, placeholder: "e.g., Mulino Bianco" },
  category: { label: "Category", icon: Briefcase, placeholder: "e.g., Snack Salati" },
  function: { label: "Function", icon: UsersThree, placeholder: "e.g., Category Management" },
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

export function WorkspaceOnboarding() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<Role | null>(null);
  const [roleOther, setRoleOther] = useState("");
  const [scopes, setScopes] = useState<ScopeInput[]>([]);
  const [stakeholders, setStakeholders] = useState<StakeholderInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAdvance1 = role !== null && (role !== "other" || roleOther.trim().length > 0);
  const canAdvance2 = scopes.some((s) => s.name.trim().length > 0);

  const namedScopes = useMemo(
    () => scopes.filter((s) => s.name.trim().length > 0),
    [scopes],
  );

  function addScope(kind: ScopeKind) {
    setScopes((prev) => [...prev, { id: uid(), kind, name: "" }]);
  }
  function updateScope(id: string, name: string) {
    setScopes((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  }
  function removeScope(id: string) {
    setScopes((prev) => prev.filter((s) => s.id !== id));
    setStakeholders((prev) => prev.filter((h) => h.scopeKey !== scopeKeyFor(id)));
  }

  function scopeKeyFor(scopeId: string): string {
    const scope = scopes.find((s) => s.id === scopeId);
    if (!scope) return "";
    return `${scope.kind}:${slugify(scope.name)}`;
  }

  function addStakeholder(scopeKey: string) {
    setStakeholders((prev) => [
      ...prev,
      { id: uid(), scopeKey, name: "", role: "", preference: "" },
    ]);
  }
  function updateStakeholder(id: string, patch: Partial<StakeholderInput>) {
    setStakeholders((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  }
  function removeStakeholder(id: string) {
    setStakeholders((prev) => prev.filter((h) => h.id !== id));
  }

  async function submit(skipped: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const scopePayload = namedScopes.map((s) => ({
        kind: s.kind,
        name: s.name.trim(),
      }));
      const stakeholderPayload = stakeholders
        .filter((h) => h.name.trim().length > 0)
        .map((h) => {
          const [kind, slug] = h.scopeKey.split(":");
          return {
            scope_kind: kind as ScopeKind,
            scope_slug: slug,
            name: h.name.trim(),
            role: h.role.trim() || undefined,
            preference: h.preference.trim() || undefined,
          };
        });

      const response = await fetch("/api/workspace/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: role ?? "other",
          role_other: roleOther.trim() || undefined,
          scopes: skipped ? [] : scopePayload,
          stakeholders: skipped ? [] : stakeholderPayload,
          skipped,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not complete onboarding.");
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
        <h1 className="wbeta-onboard-title">
          Basquio is a memory, not a chatbot. Four questions and you are ready.
        </h1>
        <p className="wbeta-onboard-lede">
          Every answer Basquio writes will lean on what you teach it here. Skip any step you want,
          you can always teach more later.
        </p>
      </header>

      <ol className="wbeta-onboard-stepper" aria-label="Onboarding progress">
        {[1, 2, 3, 4].map((n) => (
          <li
            key={n}
            className={
              n < step
                ? "wbeta-onboard-step wbeta-onboard-step-done"
                : n === step
                ? "wbeta-onboard-step wbeta-onboard-step-active"
                : "wbeta-onboard-step"
            }
            aria-current={n === step ? "step" : undefined}
          >
            <span className="wbeta-onboard-step-num">{n < step ? <Check size={12} weight="bold" /> : n}</span>
            <span className="wbeta-onboard-step-label">
              {n === 1 ? "Role" : n === 2 ? "Scopes" : n === 3 ? "Stakeholders" : "Seed files"}
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
        <section className="wbeta-onboard-panel">
          <h2 className="wbeta-onboard-step-title">Which hat do you wear most?</h2>
          <p className="wbeta-onboard-step-hint">
            We tune tone, depth, and defaults to this. You can change it any time.
          </p>
          <div className="wbeta-onboard-roles">
            {ROLE_OPTIONS.map((opt) => {
              const active = role === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={
                    active
                      ? "wbeta-onboard-role wbeta-onboard-role-active"
                      : "wbeta-onboard-role"
                  }
                  onClick={() => setRole(opt.value)}
                  aria-pressed={active}
                >
                  <span className="wbeta-onboard-role-label">{opt.label}</span>
                  <span className="wbeta-onboard-role-hint">{opt.hint}</span>
                </button>
              );
            })}
          </div>
          {role === "other" ? (
            <label className="wbeta-onboard-field wbeta-onboard-field-wide">
              <span>One-line description of your role</span>
              <input
                type="text"
                value={roleOther}
                onChange={(e) => setRoleOther(e.target.value)}
                placeholder="e.g., Head of Insights at a retailer"
                maxLength={200}
              />
            </label>
          ) : null}
        </section>
      ) : null}

      {step === 2 ? (
        <section className="wbeta-onboard-panel">
          <h2 className="wbeta-onboard-step-title">Which clients or categories do you work on?</h2>
          <p className="wbeta-onboard-step-hint">
            Each one becomes a scope. Memory and files can be attached per scope, so answers stay
            on the right brand.
          </p>
          <div className="wbeta-onboard-scope-list">
            {scopes.length === 0 ? (
              <p className="wbeta-onboard-empty">Add your first scope below.</p>
            ) : null}
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
                    onChange={(e) => updateScope(scope.id, e.target.value)}
                    maxLength={120}
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
                  className="wbeta-onboard-add-btn"
                  onClick={() => addScope(kind)}
                >
                  <Plus size={12} weight="bold" />
                  <Icon size={13} weight="regular" />
                  Add {SCOPE_KIND_META[kind].label.toLowerCase()}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="wbeta-onboard-panel">
          <h2 className="wbeta-onboard-step-title">Who are the key stakeholders?</h2>
          <p className="wbeta-onboard-step-hint">
            One line per person is enough. Basquio tailors every answer that cites them to their
            preferences.
          </p>
          {namedScopes.length === 0 ? (
            <p className="wbeta-onboard-empty">
              Go back to step 2 to add a scope first, or skip this step.
            </p>
          ) : (
            <div className="wbeta-onboard-stakeholders">
              {namedScopes.map((scope) => {
                const Icon = SCOPE_KIND_META[scope.kind].icon;
                const scopeKey = `${scope.kind}:${slugify(scope.name)}`;
                const rows = stakeholders.filter((h) => h.scopeKey === scopeKey);
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
                      <p className="wbeta-onboard-empty-small">No stakeholders yet for this scope.</p>
                    ) : (
                      rows.map((row) => (
                        <div key={row.id} className="wbeta-onboard-stakeholder-row">
                          <label className="wbeta-onboard-field">
                            <span>Name</span>
                            <input
                              type="text"
                              value={row.name}
                              onChange={(e) => updateStakeholder(row.id, { name: e.target.value })}
                              placeholder="e.g., Elena Bianchi"
                              maxLength={200}
                            />
                          </label>
                          <label className="wbeta-onboard-field">
                            <span>Role</span>
                            <input
                              type="text"
                              value={row.role}
                              onChange={(e) => updateStakeholder(row.id, { role: e.target.value })}
                              placeholder="e.g., Head of Category"
                              maxLength={200}
                            />
                          </label>
                          <label className="wbeta-onboard-field wbeta-onboard-field-wide">
                            <span>One-line preference</span>
                            <input
                              type="text"
                              value={row.preference}
                              onChange={(e) => updateStakeholder(row.id, { preference: e.target.value })}
                              placeholder="e.g., prefers waterfall over bar charts for competitive decomp"
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

      {step === 4 ? (
        <section className="wbeta-onboard-panel">
          <h2 className="wbeta-onboard-step-title">Seed the workspace with one to three files.</h2>
          <p className="wbeta-onboard-step-hint">
            A prior brief, a transcript, a deck, or a data export. Basquio reads them all and turns
            them into memory. Skip and upload later if you want.
          </p>
          <WorkspaceUploadZone supportedLabel={SUPPORTED_UPLOAD_LABEL} variant="hero" />
          <p className="wbeta-onboard-help">
            Uploads run in the background. You can move to the workspace as soon as you finish.
          </p>
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
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={busy}
            >
              <ArrowLeft size={13} weight="bold" /> Back
            </button>
          ) : null}
          {step < 4 ? (
            <button
              type="button"
              className="wbeta-onboard-next"
              onClick={() => setStep((s) => Math.min(4, s + 1))}
              disabled={busy || (step === 1 && !canAdvance1) || (step === 2 && !canAdvance2)}
            >
              Continue <ArrowRight size={13} weight="bold" />
            </button>
          ) : (
            <button
              type="button"
              className="wbeta-onboard-finish"
              onClick={() => submit(false)}
              disabled={busy}
            >
              {busy ? "Finishing…" : "Finish setup"}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
