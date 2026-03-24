"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import * as tus from "tus-js-client";

import { reportTypePresets } from "@/app/site-content";

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

type GenerationFormProps = {
  savedTemplates?: SavedTemplateOption[];
};

export function GenerationForm({ savedTemplates = [] }: GenerationFormProps) {
  const router = useRouter();
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  const brandInputRef = useRef<HTMLInputElement>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDraggingEvidence, setIsDraggingEvidence] = useState(false);
  const [isDraggingBrand, setIsDraggingBrand] = useState(false);
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [brandFile, setBrandFile] = useState<File | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const selectedTemplate = savedTemplates.find((t) => t.id === selectedTemplateId) ?? null;
  const templateLabel = selectedTemplate ? selectedTemplate.name : brandFile ? brandFile.name : "Basquio Standard";
  const [selectedReportType, setSelectedReportType] = useState<string | null>(null);
  const [targetSlideCount, setTargetSlideCount] = useState(10);
  const creditsNeeded = 3 + targetSlideCount; // 3 base + 1 per slide
  const [brief, setBrief] = useState<BriefFields>({
    businessContext: "",
    client: "",
    audience: "",
    objective: "",
    thesis: "",
    stakes: "",
  });

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
      validateSubmission(evidenceFiles, brief);

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
          brandFile:
            brandFile instanceof File && brandFile.size > 0
              ? {
                  fileName: brandFile.name,
                  mediaType: brandFile.type || "application/octet-stream",
                  sizeBytes: brandFile.size,
                }
              : undefined,
        }),
      });

      const preparePayload = (await readApiPayload(prepareResponse)) as PrepareUploadsResponse & { error?: string };

      if (!prepareResponse.ok) {
        throw new Error(preparePayload.error ?? "Unable to prepare uploads.");
      }

      await uploadPreparedFiles(evidenceFiles, preparePayload.evidenceUploads);

      if (brandFile instanceof File && brandFile.size > 0 && preparePayload.brandUpload) {
        await uploadPreparedFile(brandFile, preparePayload.brandUpload);
      }

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
          styleFile: preparePayload.brandUpload ? stripUploadTransportFields(preparePayload.brandUpload) : undefined,
          templateProfileId: selectedTemplateId ?? undefined,
          targetSlideCount,
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

    if (currentStep === 1 && evidenceFiles.length === 0) {
      setError("Add at least one data file before continuing.");
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

  function openBrandPicker() {
    brandInputRef.current?.click();
  }

  function updateEvidenceFiles(files: File[]) {
    setEvidenceFiles((current) => {
      const merged = mergeFiles(current, files);
      syncInputFiles(evidenceInputRef.current, merged);
      return merged;
    });
    setError(null);
  }

  function updateBrandFile(file: File | null) {
    setBrandFile(file);
    syncInputFiles(brandInputRef.current, file ? [file] : []);
    setError(null);
  }

  function handleEvidenceInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    updateEvidenceFiles(Array.from(event.target.files ?? []));
  }

  function handleBrandInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    updateBrandFile(event.target.files?.[0] ?? null);
  }

  function updateBriefField(field: keyof BriefFields, value: string) {
    setBrief((current) => ({
      ...current,
      [field]: value,
    }));
    setError(null);
  }

  function handleDrop(
    event: React.DragEvent<HTMLElement>,
    kind: "evidence" | "brand",
  ) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files ?? []);

    if (kind === "evidence") {
      setIsDraggingEvidence(false);
      updateEvidenceFiles(files);
      return;
    }

    setIsDraggingBrand(false);
    updateBrandFile(files[0] ?? null);
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
              <h2>Upload your data</h2>
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
                  onDrop={(event) => handleDrop(event, "evidence")}
                >
                  <span className="dropzone-icon" aria-hidden>
                    +
                  </span>
                  <span className="dropzone-title">Drop data files here</span>
                  <span className="dropzone-copy">CSV, Excel, and supporting documents</span>
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

                {evidenceFiles.length > 0 ? (
                  <div className="file-list">
                    {evidenceFiles.map((file) => (
                      <div key={`${file.name}-${file.size}`} className="file-chip">
                        <span>{file.name}</span>
                        <small>{formatFileSize(file.size)}</small>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="stack">
                <button
                  className={isDraggingBrand ? "dropzone dropzone-active" : "dropzone dropzone-secondary"}
                  type="button"
                  onClick={openBrandPicker}
                  onDragEnter={() => setIsDraggingBrand(true)}
                  onDragLeave={() => setIsDraggingBrand(false)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleDrop(event, "brand")}
                >
                  <span className="dropzone-icon" aria-hidden>
                    +
                  </span>
                  <span className="dropzone-title">Add a template</span>
                  <span className="dropzone-copy">Optional PPTX, JSON, CSS, or PDF reference</span>
                </button>

                <input
                  ref={brandInputRef}
                  className="sr-only-input"
                  name="brandFile"
                  type="file"
                  accept=".json,.css,.pptx,.pdf"
                  onChange={handleBrandInputChange}
                />

                {brandFile ? (
                  <div className="file-chip">
                    <span>{brandFile.name}</span>
                    <small>{formatFileSize(brandFile.size)}</small>
                    <button type="button" className="file-chip-remove" onClick={() => setBrandFile(null)}>Remove</button>
                  </div>
                ) : null}

                {savedTemplates.length > 0 && !brandFile ? (
                  <div className="stack-xs">
                    <p className="muted">Or use a saved template:</p>
                    <div className="template-picker">
                      <button
                        type="button"
                        className={selectedTemplateId === null ? "template-option selected" : "template-option"}
                        onClick={() => setSelectedTemplateId(null)}
                      >
                        <span className="template-option-name">Basquio Standard</span>
                        <span className="template-option-type">Default</span>
                      </button>
                      {savedTemplates.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className={selectedTemplateId === t.id ? "template-option selected" : "template-option"}
                          onClick={() => setSelectedTemplateId(t.id)}
                        >
                          <span className="template-option-name">{t.name}</span>
                          <span className="template-option-type">{t.sourceType}</span>
                          {t.colors.length > 0 ? (
                            <span className="template-option-colors">
                              {t.colors.map((c) => (
                                <span key={c} className="mini-swatch" style={{ backgroundColor: c }} />
                              ))}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {currentStep === 2 ? (
          <section className="step-panel stack-lg">
            <div className="stack-xs">
              <p className="section-label">Step 3</p>
              <h2>Describe the brief</h2>
            </div>

            <div className="form-grid">
              <label className="field field-span-2">
                <span>Business context</span>
                <textarea
                  name="businessContext"
                  value={brief.businessContext}
                  rows={6}
                  placeholder="What is happening in the business, and what does your audience need to understand?"
                  onChange={(event) => updateBriefField("businessContext", event.target.value)}
                />
              </label>

              <label className="field">
                <span>Audience</span>
                <input
                  name="audience"
                  value={brief.audience}
                  placeholder="Leadership team, client, or review audience"
                  onChange={(event) => updateBriefField("audience", event.target.value)}
                />
              </label>

              <label className="field">
                <span>Objective</span>
                <input
                  name="objective"
                  value={brief.objective}
                  placeholder="What decision or takeaway should this analysis support?"
                  onChange={(event) => updateBriefField("objective", event.target.value)}
                />
              </label>

              <details className="field-span-2">
                <summary>Additional context (optional)</summary>

                <div className="form-grid">
                  <label className="field">
                    <span>Client</span>
                    <input
                      name="client"
                      value={brief.client}
                      placeholder="Optional"
                      onChange={(event) => updateBriefField("client", event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>Thesis</span>
                    <input
                      name="thesis"
                      value={brief.thesis}
                      placeholder="Optional working point of view"
                      onChange={(event) => updateBriefField("thesis", event.target.value)}
                    />
                  </label>

                  <label className="field field-span-2">
                    <span>Stakes</span>
                    <textarea
                      name="stakes"
                      value={brief.stakes}
                      rows={4}
                      placeholder="Optional: why this matters now and what depends on it"
                      onChange={(event) => updateBriefField("stakes", event.target.value)}
                    />
                  </label>
                </div>
              </details>
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
                <p className="artifact-kind">Data</p>
                <p>{evidenceFiles.length > 0 ? `${evidenceFiles.length} file${evidenceFiles.length === 1 ? "" : "s"}` : "No files added yet"}</p>
                {evidenceFiles.length > 0 ? (
                  <div className="file-list">
                    {evidenceFiles.map((file) => (
                      <div key={`${file.name}-${file.size}-${file.lastModified}`} className="file-chip">
                        <span>{file.name}</span>
                        <small>{formatFileSize(file.size)}</small>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>

              <article className="review-card stack">
                <p className="artifact-kind">Design template</p>
                <p>{templateLabel}</p>
                {brandFile ? (
                  <p className="muted">Your colors and fonts will be extracted and applied to the locked slide grid.</p>
                ) : selectedTemplate ? (
                  <p className="muted">Saved template applied. Colors, fonts, and style locked to the slide grid.</p>
                ) : (
                  <p className="muted">Clean editorial design with the default locked slide grid.</p>
                )}
              </article>

              <article className="review-card stack">
                <p className="artifact-kind">Deck size</p>
                <div className="slide-count-selector">
                  <label className="stack-xs">
                    <span style={{ fontSize: "0.88rem" }}>{targetSlideCount} slides — {creditsNeeded} credits</span>
                    <input
                      type="range"
                      min={3}
                      max={20}
                      value={targetSlideCount}
                      onChange={(e) => setTargetSlideCount(Number(e.target.value))}
                      style={{ width: "100%" }}
                    />
                    <span className="muted" style={{ fontSize: "0.78rem", display: "flex", justifyContent: "space-between" }}>
                      <span>3 slides</span>
                      <span>20 slides</span>
                    </span>
                  </label>
                </div>
              </article>

              <article className="review-card stack">
                <p className="artifact-kind">Output</p>
                <p className="muted" style={{ fontSize: "0.9rem" }}>
                  PPTX + PDF — charts render as locked visuals for consistent PowerPoint, Google Slides, and Keynote output.
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

function syncInputFiles(input: HTMLInputElement | null, files: File[]) {
  if (!input) {
    return;
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
) {
  if (evidenceFiles.length === 0) {
    throw new Error("Add at least one data file before generating.");
  }

  if (!brief.businessContext || !brief.audience || !brief.objective) {
    throw new Error("Add the business context, audience, and objective before generating.");
  }
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
