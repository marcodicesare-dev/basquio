"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import * as tus from "tus-js-client";

import { reportTypePresets } from "@/app/site-content";
import { DEFAULT_AUTHOR_MODEL, MAX_TARGET_SLIDES, calculateRunCredits } from "@/lib/credits";

const UI_MIN_TARGET_SLIDES = 3;
const UI_MAX_TARGET_SLIDES = MAX_TARGET_SLIDES;

const MODEL_OPTIONS = [
  {
    id: "claude-opus-4-6",
    name: "Deep-Dive",
    description: "Consulting-grade depth. The full treatment.",
    badge: null,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Deck",
    description: "Full analysis deck with real charts.",
    badge: "default",
  },
  {
    id: "claude-haiku-4-5",
    name: "Memo",
    description: "Data tables + narrative report. No slides.",
    badge: null,
  },
] as const;

const BRIEF_SIGNAL_LIBRARY = [
  {
    label: "Share loss diagnosis",
    keywords: ["share loss", "lost share", "share erosion", "value share", "market share"],
  },
  {
    label: "Pricing and promo tension",
    keywords: ["price", "pricing", "promo", "promotion", "discount", "gross-to-net", "gtm"],
  },
  {
    label: "Distribution gap",
    keywords: ["distribution", "availability", "shelf", "retailer", "banner", "channel"],
  },
  {
    label: "Competitive response",
    keywords: ["competitor", "private label", "rival", "threat", "white space"],
  },
  {
    label: "Portfolio and mix",
    keywords: ["mix", "portfolio", "segment", "assortment", "hero sku", "sku"],
  },
  {
    label: "Innovation and launch readout",
    keywords: ["innovation", "launch", "new product", "npd", "trial"],
  },
] as const;

const BRIEF_COACHING_POINTS = [
  "Name the problem with numbers or a timeframe, not just a topic.",
  "Describe the audience as a role and meeting, not a generic group.",
  "Write the decision the deck should support: diagnose, recommend, quantify, defend.",
  "Use thesis and stakes to make the story sharper, not longer.",
] as const;

const BRIEF_EXAMPLE = {
  businessContext:
    "Our pet food brand lost 1.2pp value share in Modern Trade over the last 52 weeks while the category grew +2.2%. Private label gained +3.8pp in the mid-tier segment.",
  audience: "Category Director + Finance VP at Carrefour",
  objective: "Identify the root causes of share loss and recommend 3 actions to recover share within 2 quarters.",
  thesis: "Private label is winning on price-per-kg where our distribution is weakest.",
  stakes: "We need evidence-backed positions for the annual JBP and shelf-space discussion in 6 weeks.",
} as const;

type AuthorModel = (typeof MODEL_OPTIONS)[number]["id"];

type GenerationStartResponse = {
  jobId: string;
  status: "queued";
  statusUrl: string;
  progressUrl: string;
  message: string;
};

type PreparedUpload = {
  id: string;
  fileName: string;
  mediaType: string;
  kind: string;
  storageBucket: string;
  storagePath: string;
  fileBytes: number;
  uploadMode: "standard" | "resumable";
  signedUrl?: string;
  resumableUrl?: string;
  chunkSizeBytes?: number;
  token: string;
};

type PrepareUploadsResponse = {
  jobId: string;
  organizationId: string;
  projectId: string;
  evidenceUploads: PreparedUpload[];
  brandUpload: PreparedUpload | null;
};

type BriefFields = {
  businessContext: string;
  client: string;
  audience: string;
  objective: string;
  thesis: string;
  stakes: string;
};

const steps = [
  {
    id: "report-type",
    title: "1. Report type",
  },
  {
    id: "upload",
    title: "2. Upload your files",
  },
  {
    id: "brief",
    title: "3. Describe the brief",
  },
  {
    id: "review",
    title: "4. Review & generate",
  },
] as const;

type SavedTemplateOption = {
  id: string;
  name: string;
  sourceType: string;
  colors: string[];
};

type RecipePrefill = {
  id: string;
  /** Only set when prefill comes from a saved recipe, not a prior run */
  recipeId: string | null;
  name: string;
  brief: {
    businessContext?: string;
    client?: string;
    audience?: string;
    objective?: string;
    thesis?: string;
    stakes?: string;
  };
  templateProfileId: string | null;
  targetSlideCount: number;
  authorModel?: AuthorModel;
  sourceFiles?: Array<{
    id: string;
    kind: string;
    fileName: string;
    storageBucket: string;
    storagePath: string;
    fileBytes: number;
  }>;
};

type GenerationFormProps = {
  savedTemplates?: SavedTemplateOption[];
  defaultTemplateId?: string | null;
  recipePrefill?: RecipePrefill;
};

export function GenerationForm({ savedTemplates = [], defaultTemplateId = null, recipePrefill }: GenerationFormProps) {
  const router = useRouter();
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDraggingEvidence, setIsDraggingEvidence] = useState(false);
  const [prefillSourceFiles] = useState(recipePrefill?.sourceFiles ?? []);
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(() => {
    const prefillId = recipePrefill?.templateProfileId ?? defaultTemplateId ?? null;
    // Only use a prefilled template ID if it actually exists in the ready template list
    if (prefillId && savedTemplates.some((t) => t.id === prefillId)) {
      return prefillId;
    }
    return null;
  });
  const selectedTemplate = savedTemplates.find((t) => t.id === selectedTemplateId) ?? null;
  const defaultTemplateName = savedTemplates.find((t) => t.id === defaultTemplateId)?.name;
  const templateLabel = selectedTemplate ? selectedTemplate.name : "Basquio Standard";
  const [selectedReportType, setSelectedReportType] = useState<string | null>(null);
  const [targetSlideCount, setTargetSlideCount] = useState(clampTargetSlideCount(recipePrefill?.targetSlideCount ?? 10));
  const [selectedModel, setSelectedModel] = useState<AuthorModel>(
    MODEL_OPTIONS.some((option) => option.id === recipePrefill?.authorModel)
      ? (recipePrefill?.authorModel as AuthorModel)
      : DEFAULT_AUTHOR_MODEL,
  );
  const isReportOnlyTier = selectedModel === "claude-haiku-4-5";
  const creditsNeeded = isReportOnlyTier ? 3 : calculateRunCredits(targetSlideCount, selectedModel);
  const [brief, setBrief] = useState<BriefFields>({
    businessContext: recipePrefill?.brief.businessContext ?? "",
    client: recipePrefill?.brief.client ?? "",
    audience: recipePrefill?.brief.audience ?? "",
    objective: recipePrefill?.brief.objective ?? "",
    thesis: recipePrefill?.brief.thesis ?? "",
    stakes: recipePrefill?.brief.stakes ?? "",
  });
  // When loading from a recipe, skip to the upload step
  const [currentStep, setCurrentStep] = useState(recipePrefill ? 1 : 0);
  const briefReadiness = summarizeBriefReadiness(brief);
  const briefSignals = inferBriefSignals(brief);
  const briefWarnings = buildBriefWarnings(brief);

  // Track whether the submit was from the explicit button click
  const submitIntentRef = useRef(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Prevent accidental form submission from Enter key on non-final steps
    if (currentStep < steps.length - 1) {
      goToNextStep();
      return;
    }
    // On the final step, only submit if the user explicitly clicked the button
    if (!submitIntentRef.current) {
      return;
    }
    submitIntentRef.current = false;
    setIsSubmitting(true);
    setError(null);

    try {
      validateSubmission(evidenceFiles, brief, prefillSourceFiles.length);
      const effectiveTargetSlideCount = isReportOnlyTier ? 1 : targetSlideCount;

      // If reusing files from a prior run, skip upload and reference existing source files directly
      if (prefillSourceFiles.length > 0 && evidenceFiles.length === 0) {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organizationId: "local-org",
            projectId: "local-project",
            existingSourceFileIds: prefillSourceFiles.map((sf) => sf.id),
            templateProfileId: selectedTemplateId ?? undefined,
            targetSlideCount: effectiveTargetSlideCount,
            authorModel: selectedModel,
            recipeId: recipePrefill?.recipeId ?? undefined,
            brief,
            businessContext: brief.businessContext,
            client: brief.client,
            audience: brief.audience,
            objective: brief.objective,
            thesis: brief.thesis,
            stakes: brief.stakes,
          }),
        });
        const payload = await readGenerationPayload(response);
        if (response.status === 402) {
          router.push((payload as { pricingUrl?: string }).pricingUrl ?? "/pricing");
          return;
        }
        if (!response.ok) {
          throw new Error(payload.error ?? "Generation failed.");
        }
        router.push(payload.progressUrl);
        return;
      }

      const prepareResponse = await fetch("/api/uploads/prepare", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId: "local-org",
          projectId: "local-project",
          evidenceFiles: evidenceFiles.map((file) => ({
            fileName: file.name,
            mediaType: file.type || "application/octet-stream",
            sizeBytes: file.size,
          })),
        }),
      });

      const preparePayload = (await readApiPayload(prepareResponse)) as PrepareUploadsResponse & { error?: string };

      if (!prepareResponse.ok) {
        throw new Error(preparePayload.error ?? "Unable to prepare uploads.");
      }

      await uploadPreparedFiles(evidenceFiles, preparePayload.evidenceUploads);

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jobId: preparePayload.jobId,
          organizationId: preparePayload.organizationId,
          projectId: preparePayload.projectId,
          sourceFiles: preparePayload.evidenceUploads.map(stripUploadTransportFields),
          templateProfileId: selectedTemplateId ?? undefined,
          targetSlideCount: effectiveTargetSlideCount,
          authorModel: selectedModel,
          recipeId: recipePrefill?.recipeId ?? undefined,
          brief,
          businessContext: brief.businessContext,
          client: brief.client,
          audience: brief.audience,
          objective: brief.objective,
          thesis: brief.thesis,
          stakes: brief.stakes,
        }),
      });

      const payload = await readGenerationPayload(response);

      if (response.status === 402) {
        // No credits — redirect to pricing
        router.push((payload as { pricingUrl?: string }).pricingUrl ?? "/pricing");
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "Generation failed.");
      }

      router.push(payload.progressUrl);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Generation failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function selectReportType(presetId: string) {
    setSelectedReportType(presetId);
    const preset = reportTypePresets.find((p) => p.id === presetId);
    if (preset && preset.id !== "custom") {
      setBrief((current) => ({
        ...current,
        businessContext: current.businessContext || preset.briefTemplate,
        audience: current.audience || preset.audience,
        objective: current.objective || preset.title,
      }));
    }
    setError(null);
    setCurrentStep(1);
  }

  function goToNextStep() {
    if (currentStep === 0) {
      // Report type step — skip to upload even without selection
      setError(null);
      setCurrentStep(1);
      return;
    }

    if (currentStep === 1 && evidenceFiles.length === 0 && prefillSourceFiles.length === 0) {
      setError("Add at least one supported evidence file before continuing.");
      return;
    }

    if (currentStep === 2) {
      if (!brief.businessContext || !brief.audience || !brief.objective) {
        setError("Add the business context, audience, and objective before continuing.");
        return;
      }
    }

    setError(null);
    setCurrentStep((step) => Math.min(step + 1, steps.length - 1));
  }

  function goToPreviousStep() {
    setError(null);
    setCurrentStep((step) => Math.max(step - 1, 0));
  }

  function openEvidencePicker() {
    evidenceInputRef.current?.click();
  }

  function updateEvidenceFiles(files: File[]) {
    setEvidenceFiles((current) => {
      const merged = mergeFiles(current, files);
      syncInputFiles(evidenceInputRef.current, merged);
      return merged;
    });
    setError(null);
  }

  function removeEvidenceFile(fileToRemove: File) {
    setEvidenceFiles((current) => {
      const filtered = current.filter((file) => makeFileKey(file) !== makeFileKey(fileToRemove));
      syncInputFiles(evidenceInputRef.current, filtered);
      return filtered;
    });
    setError(null);
  }

  function handleTemplateSelection(templateId: string | null) {
    setSelectedTemplateId(templateId);
    setError(null);
  }

  function handleEvidenceInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    updateEvidenceFiles(Array.from(event.target.files ?? []));
  }

  function updateBriefField(field: keyof BriefFields, value: string) {
    setBrief((current) => ({
      ...current,
      [field]: value,
    }));
    setError(null);
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDraggingEvidence(false);
    updateEvidenceFiles(Array.from(event.dataTransfer.files ?? []));
  }

  return (
    <div className="stack-lg">
      <form className="panel form-shell stack-xl" onSubmit={handleSubmit}>
        <div className="stepper-track" aria-label="Analysis setup steps">
          {steps.map((step, index) => {
            const state =
              index === currentStep ? "active" : index < currentStep ? "done" : "upcoming";

            return (
              <button
                key={step.id}
                className={`step-chip step-chip-${state}`}
                type="button"
                onClick={() => setCurrentStep(index)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{step.title}</strong>
              </button>
            );
          })}
        </div>

        {currentStep === 0 ? (
          <section className="step-panel stack-lg">
            <div className="stack-xs">
              <p className="section-label">Step 1</p>
              <h2>What kind of report?</h2>
              <p className="muted">Choose a preset to pre-fill the brief, or start from scratch.</p>
            </div>

            <div className="report-type-grid">
              {reportTypePresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={selectedReportType === preset.id ? "report-type-card selected" : "report-type-card"}
                  onClick={() => selectReportType(preset.id)}
                >
                  <strong>{preset.title}</strong>
                  {preset.id !== "custom" ? (
                    <span className="muted">{preset.audience}</span>
                  ) : (
                    <span className="muted">Write your own brief from scratch</span>
                  )}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {currentStep === 1 ? (
          <section className="step-panel stack-lg">
            <div className="stack-xs">
              <p className="section-label">Step 2</p>
              <h2>Upload your evidence</h2>
              <p className="muted">Add data files or presentation evidence. Excel/CSV gives the deepest analysis; PPTX/PDF also work for re-analysis, extraction, and refresh.</p>
            </div>

            <div className="step-grid">
              <div className="stack">
                <button
                  className={isDraggingEvidence ? "dropzone dropzone-active" : "dropzone"}
                  type="button"
                  onClick={openEvidencePicker}
                  onDragEnter={() => setIsDraggingEvidence(true)}
                  onDragLeave={() => setIsDraggingEvidence(false)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                >
                  <span className="dropzone-icon" aria-hidden>
                    +
                  </span>
                  <span className="dropzone-title">Drop evidence files here</span>
                  <span className="dropzone-copy">Supported: CSV, XLSX, XLS, PPTX, PDF, DOCX, text, JSON, CSS, or images. For the deepest analysis, upload the source Excel too.</span>
                </button>

                <input
                  ref={evidenceInputRef}
                  className="sr-only-input"
                  name="evidenceFiles"
                  type="file"
                  accept=".csv,.xlsx,.xls,.doc,.docx,.txt,.md,.pdf,.pptx,.json,.css,.png,.jpg,.jpeg,.gif,.svg,.webp"
                  multiple
                  onChange={handleEvidenceInputChange}
                />

                {prefillSourceFiles.length > 0 && evidenceFiles.length === 0 ? (
                  <div className="file-list">
                    <p className="muted" style={{ fontSize: "0.82rem", marginBottom: "0.5rem" }}>
                      Files from your previous run (will be reused):
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                      {prefillSourceFiles.map((sf) => (
                        <span
                          key={sf.id}
                          style={{
                            border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: 999,
                            padding: "0.3rem 0.6rem",
                            color: "#D7D3CD",
                            fontSize: "0.82rem",
                          }}
                        >
                          {sf.fileName}
                        </span>
                      ))}
                    </div>
                    <p className="muted" style={{ fontSize: "0.78rem", marginTop: 4 }}>
                      {prefillSourceFiles.length} file{prefillSourceFiles.length === 1 ? "" : "s"} · {formatFileSize(prefillSourceFiles.reduce((sum, f) => sum + f.fileBytes, 0))} total. Drop new files above to replace them.
                    </p>
                  </div>
                ) : null}

                {evidenceFiles.length > 0 ? (
                  <div className="file-list">
                    {evidenceFiles.map((file) => (
                      <div key={`${file.name}-${file.size}-${file.lastModified}`} className="file-chip">
                        <span className="file-chip-type">{inferFileType(file.name)}</span>
                        <span>{file.name}</span>
                        <small>{formatFileSize(file.size)}</small>
                        <button
                          type="button"
                          className="file-chip-remove"
                          onClick={() => removeEvidenceFile(file)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  <p className="muted" style={{ fontSize: "0.78rem", marginTop: 4 }}>
                      {evidenceFiles.length} file{evidenceFiles.length === 1 ? "" : "s"} · {formatFileSize(evidenceFiles.reduce((sum, f) => sum + f.size, 0))} total
                  </p>
                  </div>
                ) : null}
              </div>

              <div className="stack">
                <div className="stack-xs">
                  <p className="section-label">Which template should this report use?</p>
                  <div className="template-picker" role="radiogroup" aria-label="Template selection">
                    {defaultTemplateId && defaultTemplateName ? (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selectedTemplateId === defaultTemplateId}
                        className={selectedTemplateId === defaultTemplateId ? "template-option selected" : "template-option"}
                        onClick={() => handleTemplateSelection(defaultTemplateId)}
                      >
                        <span className="template-radio-dot" aria-hidden />
                        <span className="template-option-content">
                          <span className="template-option-name">{defaultTemplateName}</span>
                          <span className="template-option-type">Workspace default — used automatically across your workspace</span>
                        </span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selectedTemplateId === null}
                      className={selectedTemplateId === null ? "template-option selected" : "template-option"}
                      onClick={() => handleTemplateSelection(null)}
                    >
                      <span className="template-radio-dot" aria-hidden />
                      <span className="template-option-content">
                        <span className="template-option-name">Basquio Standard</span>
                        <span className="template-option-type">Use Basquio&apos;s built-in style for this report</span>
                      </span>
                    </button>
                    {savedTemplates
                      .filter((t) => t.id !== defaultTemplateId)
                      .map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={selectedTemplateId === t.id}
                        className={selectedTemplateId === t.id ? "template-option selected" : "template-option"}
                        onClick={() => handleTemplateSelection(t.id)}
                      >
                        <span className="template-radio-dot" aria-hidden />
                        <span className="template-option-content">
                          <span className="template-option-name">{t.name}</span>
                          <span className="template-option-type">Use only for this report</span>
                          {t.colors.length > 0 ? (
                            <span className="template-option-colors">
                              {t.colors.map((c) => (
                                <span key={c} className="mini-swatch" style={{ backgroundColor: c }} />
                              ))}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="template-selection-summary">
                    This report will use: <strong>{templateLabel}</strong>
                  </p>
                  <a href="/templates" className="button small secondary" style={{ alignSelf: "flex-start" }}>
                    Import a new template
                  </a>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {currentStep === 2 ? (
          <section className="step-panel stack-lg">
            <div className="stack-xs">
              <p className="section-label">Step 3</p>
              <h2>Describe the brief</h2>
              <p className="muted">This is where Basquio decides what kind of report it is building. A sharper brief produces a sharper narrative, evidence plan, and recommendation set.</p>
            </div>

            <div className="brief-composer-layout">
              <div className="stack-lg">
                <div className="brief-stage-banner">
                  <div className="brief-stage-banner-copy stack-xs">
                    <p className="section-label">What a strong brief includes</p>
                    <h3>One business problem. One audience. One decision.</h3>
                    <p className="muted">Keep it concrete. Numbers, roles, timing, and a point of view help the report land like it was built for a real meeting.</p>
                  </div>
                  <div className="brief-stage-banner-metrics">
                    <div>
                      <span>Readiness</span>
                      <strong>{briefReadiness.label}</strong>
                    </div>
                    <div>
                      <span>Signals</span>
                      <strong>{briefSignals.length}</strong>
                    </div>
                  </div>
                </div>

                <div className="form-grid brief-form-grid">
                  <label className="field field-span-2">
                    <span>Business context</span>
                    <small>What is happening in the business right now? Include numbers, trend shifts, competitors, or timing if you have them.</small>
                    <textarea
                      name="businessContext"
                      value={brief.businessContext}
                      rows={6}
                      placeholder="Example: Our brand lost 1.2pp value share in Modern Trade over the last 52 weeks while the category grew +2.2%."
                      onChange={(event) => updateBriefField("businessContext", event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>Audience</span>
                    <small>Use a role and context, like “VP Commercial for the QBR” or “Category Director at Tesco”.</small>
                    <input
                      name="audience"
                      value={brief.audience}
                      placeholder="Role + company or meeting context"
                      onChange={(event) => updateBriefField("audience", event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>Objective</span>
                    <small>State the decision this analysis should support: diagnose, recommend, defend, quantify, or compare.</small>
                    <input
                      name="objective"
                      value={brief.objective}
                      placeholder="Example: Identify the root causes of share loss and recommend 3 actions."
                      onChange={(event) => updateBriefField("objective", event.target.value)}
                    />
                  </label>

                  <details className="field-span-2 brief-optional-details">
                    <summary>Additional context that sharpens the narrative</summary>

                    <div className="form-grid">
                      <label className="field">
                        <span>Client</span>
                        <small>Useful when the deck is client-facing or brand-specific.</small>
                        <input
                          name="client"
                          value={brief.client}
                          placeholder="Optional"
                          onChange={(event) => updateBriefField("client", event.target.value)}
                        />
                      </label>

                      <label className="field">
                        <span>Thesis</span>
                        <small>Your working point of view. Basquio can prove it, challenge it, or refine it.</small>
                        <input
                          name="thesis"
                          value={brief.thesis}
                          placeholder="Optional working point of view"
                          onChange={(event) => updateBriefField("thesis", event.target.value)}
                        />
                      </label>

                      <label className="field field-span-2">
                        <span>Stakes</span>
                        <small>Explain why this matters now: budget review, retailer negotiation, board meeting, launch decision.</small>
                        <textarea
                          name="stakes"
                          value={brief.stakes}
                          rows={4}
                          placeholder="Optional: what depends on this and when"
                          onChange={(event) => updateBriefField("stakes", event.target.value)}
                        />
                      </label>
                    </div>
                  </details>
                </div>
              </div>

              <aside className="brief-coach-panel panel">
                <div className="stack">
                  <div className="brief-coach-head">
                    <div className="stack-xs">
                      <p className="section-label">Live brief coach</p>
                      <h3>{briefReadiness.label}</h3>
                    </div>
                    <span className={`brief-score-pill brief-score-${briefReadiness.tone}`}>{briefReadiness.score}%</span>
                  </div>

                  <p className="muted">{briefReadiness.copy}</p>

                  <div className="brief-score-track" aria-hidden>
                    <span style={{ width: `${briefReadiness.score}%` }} />
                  </div>

                  {briefWarnings.length > 0 ? (
                    <div className="brief-warning-list">
                      {briefWarnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  ) : (
                    <div className="brief-success-note">
                      <strong>The structure is there.</strong>
                      <span>Add thesis and stakes if you want the recommendations to land harder.</span>
                    </div>
                  )}

                  <div className="brief-coach-block stack-xs">
                    <p className="artifact-kind">Likely focus areas</p>
                    {briefSignals.length > 0 ? (
                      <div className="brief-signal-list">
                        {briefSignals.map((signal) => (
                          <span key={signal} className="brief-signal-chip">{signal}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">Use concrete terms like share loss, pricing, promo, distribution, channel, or competitor to guide the analytical focus.</p>
                    )}
                  </div>

                  <div className="brief-coach-block stack-xs">
                    <p className="artifact-kind">Basquio needs</p>
                    <ul className="brief-checklist">
                      {BRIEF_COACHING_POINTS.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="brief-coach-block stack-xs">
                    <p className="artifact-kind">Strong example</p>
                    <div className="brief-example-card">
                      <p><strong>Context</strong> {BRIEF_EXAMPLE.businessContext}</p>
                      <p><strong>Audience</strong> {BRIEF_EXAMPLE.audience}</p>
                      <p><strong>Objective</strong> {BRIEF_EXAMPLE.objective}</p>
                      <p><strong>Thesis</strong> {BRIEF_EXAMPLE.thesis}</p>
                      <p><strong>Stakes</strong> {BRIEF_EXAMPLE.stakes}</p>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </section>
        ) : null}

        {currentStep === 3 ? (
          <section className="step-panel stack-lg">
            <div className="stack-xs">
              <p className="section-label">Step 4</p>
              <h2>Review and generate</h2>
            </div>

            <div className="review-grid">
              <article className="review-card stack">
                <p className="artifact-kind">Evidence</p>
                <p>{evidenceFiles.length > 0
                  ? `${evidenceFiles.length} file${evidenceFiles.length === 1 ? "" : "s"}`
                  : prefillSourceFiles.length > 0
                    ? `${prefillSourceFiles.length} file${prefillSourceFiles.length === 1 ? "" : "s"} (reused from previous run)`
                    : "No files added yet"}</p>
                <p className="muted">Required: at least one supported evidence file. Excel/CSV is best for deep KPI work; PPTX/PDF also work for extraction and restyling.</p>
                {evidenceFiles.length > 0 ? (
                  <div className="file-list">
                    {evidenceFiles.map((file) => (
                      <div key={`${file.name}-${file.size}-${file.lastModified}`} className="file-chip">
                        <span>{file.name}</span>
                        <small>{formatFileSize(file.size)}</small>
                        <button
                          type="button"
                          className="file-chip-remove"
                          onClick={() => removeEvidenceFile(file)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : prefillSourceFiles.length > 0 ? (
                  <div className="file-list">
                    {prefillSourceFiles.map((sf) => (
                      <div key={sf.id} className="file-chip">
                        <span>{sf.fileName}</span>
                        <small>{formatFileSize(sf.fileBytes)}</small>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>

              <article className="review-card stack">
                <p className="artifact-kind">Design template</p>
                <p>{templateLabel}</p>
                {selectedTemplate ? (
                  <p className="muted">Saved template selected. Colors, fonts, and style cues will guide the locked slide grid.</p>
                ) : (
                  <p className="muted">Clean editorial design with the default locked slide grid.</p>
                )}
              </article>

              <article className="review-card stack">
                <p className="artifact-kind">Brief</p>
                <div className="brief-review-list">
                  <p><strong>Context</strong> {brief.businessContext || "Add the business context before generating."}</p>
                  <p><strong>Audience</strong> {brief.audience || "Add the audience."}</p>
                  <p><strong>Objective</strong> {brief.objective || "Add the decision this report should support."}</p>
                  {brief.thesis ? <p><strong>Thesis</strong> {brief.thesis}</p> : null}
                  {brief.stakes ? <p><strong>Stakes</strong> {brief.stakes}</p> : null}
                </div>
              </article>

              <article className="review-card stack">
                <p className="artifact-kind">Deck size and cost</p>
                <div className="stack-xs">
                  <p className="section-label" style={{ marginBottom: 0 }}>Model</p>
                  <div className="template-picker" role="radiogroup" aria-label="Model selection">
                    {MODEL_OPTIONS.map((option) => (
                      <label
                        key={option.id}
                        className={selectedModel === option.id ? "template-option selected model-option" : "template-option model-option"}
                      >
                        <input
                          className="sr-only-input"
                          type="radio"
                          name="authorModel"
                          value={option.id}
                          checked={selectedModel === option.id}
                          onChange={() => setSelectedModel(option.id)}
                        />
                        <span className="template-radio-dot" aria-hidden />
                        <span className="template-option-content">
                          <span className="model-option-header">
                            <span className="template-option-name">{option.name}</span>
                            {option.badge ? <span className="model-option-badge">{option.badge}</span> : null}
                          </span>
                          <span className="template-option-type">{option.description}</span>
                        </span>
                        <span className="model-option-credits">{option.id === "claude-haiku-4-5" ? "3 cr" : `${calculateRunCredits(targetSlideCount, option.id)} cr`}</span>
                      </label>
                    ))}
                  </div>
                </div>
                {!isReportOnlyTier ? (
                  <div className="slide-count-selector">
                    <label className="stack-xs">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontSize: "1.1rem", fontWeight: 700 }}>{targetSlideCount} slides</span>
                        <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--blue)" }}>{creditsNeeded} credits</span>
                      </div>
                      <input
                        type="range"
                        min={UI_MIN_TARGET_SLIDES}
                        max={UI_MAX_TARGET_SLIDES}
                        value={targetSlideCount}
                        onChange={(e) => setTargetSlideCount(clampTargetSlideCount(Number(e.target.value)))}
                        style={{ width: "100%", accentColor: "var(--blue)" }}
                      />
                      <span className="muted" style={{ fontSize: "0.78rem", display: "flex", justifyContent: "space-between" }}>
                        <span>3 slides (6 cr)</span>
                        <span>30 slides</span>
                      </span>
                    </label>
                  </div>
                ) : (
                  <p className="muted" style={{ fontSize: "0.82rem" }}>
                    This tier generates an analytical report and data pack. No presentation slides.
                  </p>
                )}
              </article>

              <article className="review-card stack">
                <p className="artifact-kind">Output</p>
                <p className="muted" style={{ fontSize: "0.9rem" }}>
                  {isReportOnlyTier
                    ? "Report + Data — Haiku produces a markdown narrative and Excel data pack for downstream review."
                    : "PPTX + Report + Data — charts stay locked in the slide output, and the report is a text-first markdown narrative with no charts for easier reuse."}
                </p>
              </article>
            </div>
          </section>
        ) : null}

        <div className="row form-actions">
          <div className="row">
            {currentStep > 0 ? (
              <button className="button secondary" type="button" onClick={goToPreviousStep}>
                Back
              </button>
            ) : null}

            {currentStep < steps.length - 1 ? (
              <button className="button" type="button" onClick={goToNextStep}>
                Continue
              </button>
            ) : (
              <button
                className="button"
                type="submit"
                disabled={isSubmitting}
                onClick={() => { submitIntentRef.current = true; }}
              >
                {isSubmitting ? "Building report..." : "Build my report"}
              </button>
            )}
          </div>

          <p className="fine-print">Basquio computes the numbers before it writes the story.</p>
        </div>
      </form>

      {error ? <div className="panel danger-panel">{error}</div> : null}
    </div>
  );
}

function clampTargetSlideCount(value: number) {
  if (!Number.isFinite(value)) {
    return 10;
  }

  return Math.min(UI_MAX_TARGET_SLIDES, Math.max(UI_MIN_TARGET_SLIDES, Math.round(value)));
}

function summarizeBriefReadiness(brief: BriefFields) {
  const businessContextWords = countWords(brief.businessContext);
  const audienceWords = countWords(brief.audience);
  const objectiveWords = countWords(brief.objective);
  const score = [
    brief.businessContext ? 30 : 0,
    brief.audience ? 20 : 0,
    brief.objective ? 20 : 0,
    businessContextWords >= 18 ? 10 : businessContextWords >= 10 ? 6 : 0,
    audienceWords >= 4 ? 8 : audienceWords >= 2 ? 5 : 0,
    objectiveWords >= 7 ? 8 : objectiveWords >= 4 ? 5 : 0,
    brief.thesis ? 7 : 0,
    brief.stakes ? 7 : 0,
  ].reduce((sum, value) => sum + value, 0);

  if (score >= 78) {
    return {
      label: "Strong brief",
      score,
      tone: "strong" as const,
      copy: "The core ingredients are in place. Basquio should have enough context to build a focused narrative instead of a generic category summary.",
    };
  }

  if (score >= 50) {
    return {
      label: "Usable brief",
      score,
      tone: "medium" as const,
      copy: "You have the basics. Add more specificity in the business context or objective if you want stronger diagnosis and recommendations.",
    };
  }

  return {
    label: "Thin brief",
    score,
    tone: "light" as const,
    copy: "Right now the form is likely to produce a broad, generic readout. Add concrete business context, a sharper audience, and a decision-led objective.",
  };
}

function inferBriefSignals(brief: BriefFields) {
  const haystack = `${brief.businessContext} ${brief.objective} ${brief.thesis}`.toLowerCase();
  return BRIEF_SIGNAL_LIBRARY.filter((signal) => signal.keywords.some((keyword) => haystack.includes(keyword))).map(
    (signal) => signal.label,
  );
}

function buildBriefWarnings(brief: BriefFields) {
  const warnings: string[] = [];

  if (!brief.businessContext) {
    warnings.push("Add a business context with numbers, trend shifts, or competitive pressure.");
  } else if (countWords(brief.businessContext) < 12) {
    warnings.push("Make the business context more concrete. One or two sentences with numbers will help.");
  }

  if (!brief.audience) {
    warnings.push("Name the audience as a role, not just a generic leadership group.");
  } else if (countWords(brief.audience) < 3) {
    warnings.push("Audience is still broad. Add a role, company, or meeting context.");
  }

  if (!brief.objective) {
    warnings.push("Write the decision the report should support.");
  } else if (!/(diagnose|identify|recommend|compare|quantify|assess|evaluate|defend|explain|recover)/i.test(brief.objective)) {
    warnings.push("Objective is a bit soft. Use an action verb like diagnose, recommend, compare, or quantify.");
  }

  return warnings;
}

function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function syncInputFiles(input: HTMLInputElement | null, files: File[]) {
  if (!input) {
    return;
  }

  if (files.length === 0) {
    input.value = "";
  }

  const dataTransfer = new DataTransfer();

  for (const file of files) {
    dataTransfer.items.add(file);
  }

  input.files = dataTransfer.files;
}

function mergeFiles(existingFiles: File[], nextFiles: File[]) {
  const merged = [...existingFiles];
  const seen = new Set(existingFiles.map(makeFileKey));

  for (const file of nextFiles) {
    const key = makeFileKey(file);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(file);
  }

  return merged;
}

function makeFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function validateSubmission(
  evidenceFiles: File[],
  brief: BriefFields,
  prefillSourceFileCount = 0,
) {
  if (evidenceFiles.length === 0 && prefillSourceFileCount === 0) {
    throw new Error("Add at least one supported evidence file before generating.");
  }

  if (!brief.businessContext || !brief.audience || !brief.objective) {
    throw new Error("Add the business context, audience, and objective before generating.");
  }
}

function inferFileType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    csv: "CSV",
    xlsx: "XLSX",
    xls: "XLS",
    pdf: "PDF",
    pptx: "PPTX",
    json: "JSON",
    css: "CSS",
    txt: "TXT",
    md: "TXT",
    doc: "DOC",
    docx: "DOCX",
    png: "IMG",
    jpg: "IMG",
    jpeg: "IMG",
  };
  return map[ext] ?? "FILE";
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${bytes} B`;
}

async function readGenerationPayload(response: Response): Promise<GenerationStartResponse & { error?: string }> {
  const payload = (await readApiPayload(response)) as GenerationStartResponse & { error?: string };

  if (response.status === 413) {
    return {
      error: "This upload was rejected upstream before direct upload completed. Retry the run; if it keeps happening, the hosted deployment is still not using the signed-upload path.",
    } as GenerationStartResponse & { error?: string };
  }

  return payload;
}

async function readApiPayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = (await response.text()).trim();
  return {
    error: text || "Request failed.",
  };
}

async function uploadPreparedFiles(files: File[], uploads: PreparedUpload[]) {
  if (files.length !== uploads.length) {
    throw new Error("Basquio prepared the wrong number of upload targets.");
  }

  await Promise.all(files.map((file, index) => uploadPreparedFile(file, uploads[index])));
}

async function uploadPreparedFile(file: File, upload: PreparedUpload) {
  if (upload.uploadMode === "resumable") {
    try {
      await uploadPreparedFileResumable(file, upload);
      return;
    } catch (error) {
      if (!upload.signedUrl) {
        throw error;
      }

      await uploadPreparedFileStandard(file, upload, {
        fallbackFromResumable: true,
      });
      return;
    }
  }

  await uploadPreparedFileStandard(file, upload);
}

async function uploadPreparedFileStandard(
  file: File,
  upload: PreparedUpload,
  options: {
    fallbackFromResumable?: boolean;
  } = {},
) {
  if (!upload.signedUrl) {
    const suffix = options.fallbackFromResumable ? " after resumable upload failed" : "";
    throw new Error(`Basquio did not return a signed upload URL for ${file.name}${suffix}.`);
  }

  const response = await fetch(upload.signedUrl, {
    method: "PUT",
    headers: {
      "cache-control": "3600",
      "content-type": file.type || upload.mediaType || "application/octet-stream",
      "x-upsert": "true",
    },
    body: file,
  });

  if (!response.ok) {
    const payload = (await readApiPayload(response)) as { error?: string };
    throw new Error(payload.error ?? `Unable to upload ${file.name}.`);
  }
}

async function uploadPreparedFileResumable(file: File, upload: PreparedUpload) {
  if (!upload.resumableUrl) {
    throw new Error(`Basquio did not return a resumable upload target for ${file.name}.`);
  }

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required for resumable uploads.");
  }

  const endpoint = upload.resumableUrl;
  const metadata = {
    bucketName: upload.storageBucket,
    objectName: upload.storagePath,
    contentType: file.type || upload.mediaType || "application/octet-stream",
    cacheControl: "3600",
  };

  const uploadTask = new tus.Upload(file, {
    endpoint,
    chunkSize: upload.chunkSizeBytes,
    retryDelays: [0, 1000, 3000, 5000],
    removeFingerprintOnSuccess: true,
    uploadDataDuringCreation: true,
    metadata,
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      "x-signature": upload.token,
      "x-upsert": "true",
    },
    onError(error) {
      throw error;
    },
  });

  const previousUploads = await uploadTask.findPreviousUploads();
  if (previousUploads[0]) {
    uploadTask.resumeFromPreviousUpload(previousUploads[0]);
  }

  await new Promise<void>((resolve, reject) => {
    uploadTask.options.onError = (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    uploadTask.options.onSuccess = () => resolve();
    uploadTask.start();
  });
}

function stripUploadTransportFields(upload: PreparedUpload) {
  return {
    id: upload.id,
    fileName: upload.fileName,
    mediaType: upload.mediaType,
    kind: upload.kind,
    storageBucket: upload.storageBucket,
    storagePath: upload.storagePath,
    fileBytes: upload.fileBytes,
  };
}
