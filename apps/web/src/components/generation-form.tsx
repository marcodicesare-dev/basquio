"use client";

import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import * as tus from "tus-js-client";

import type { GenerationRequest } from "@basquio/types";

import { reportTypePresets } from "@/app/site-content";
import {
  DEFAULT_AUTHOR_MODEL,
  MAX_TARGET_SLIDES,
  OPUS_AUTHOR_MODEL,
  STANDARD_PLAN_MAX_TARGET_SLIDES,
  calculateRunCredits,
} from "@/lib/credits";
import { saveRunLaunchDraft } from "@/lib/run-launch-draft";

const UI_MIN_TARGET_SLIDES = 3;

const MODEL_OPTIONS = [
  {
    id: OPUS_AUTHOR_MODEL,
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
    description: "Written analysis + data workbook. No slides.",
    badge: null,
  },
] as const;

const BRIEF_EXAMPLE = {
  businessContext:
    "Our pet food brand lost 1.2pp value share in Modern Trade over the last 52 weeks while the category grew +2.2%. Private label gained +3.8pp in the mid-tier segment.",
  audience: "Category Director + Finance VP at Carrefour",
  objective: "Identify the root causes of share loss and recommend 3 actions to recover share within 2 quarters.",
  thesis: "Private label is winning on price-per-kg where our distribution is weakest.",
  stakes: "We need evidence-backed positions for the annual JBP and shelf-space discussion in 6 weeks.",
} as const;

const SAMPLE_DATASET_URL = "/samples/basquio-sample-fmcg.csv";
const SAMPLE_DATASET_FILE_NAME = "basquio-sample-fmcg.csv";
const SAMPLE_BRIEF = {
  businessContext:
    "Use the sample FMCG sell-out dataset to analyze brand performance by channel and identify where Northstar is losing momentum versus BluePeak and private label.",
  audience: "Country Manager and Commercial Director in the monthly business review",
  objective: "Diagnose brand performance trends and recommend 3 growth opportunities by channel and pricing posture.",
  thesis: "Northstar is strongest in traditional trade, but share pressure in modern trade is coming from private label while BluePeak is winning e-commerce growth.",
  stakes: "The deck should help decide where to defend distribution, where to push promo intensity, and where to lean into higher-growth channels next quarter.",
} satisfies Pick<BriefFields, "businessContext" | "audience" | "objective" | "thesis" | "stakes">;

type AuthorModel = (typeof MODEL_OPTIONS)[number]["id"];

type GenerationStartResponse = {
  jobId: string;
  status: "queued";
  statusUrl: string;
  progressUrl: string;
  message: string;
};

type CreditPreview = {
  balance: number;
};

type TemplateFeeDraftResponse = {
  draftId: string;
  status: "pending_payment" | "paid";
  reused?: boolean;
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

type HostedEvidenceDraft = {
  jobId: string;
  organizationId: string;
  projectId: string;
  sourceFiles: Array<NonNullable<GenerationRequest["sourceFiles"]>[number]>;
};

type HostedEvidenceState =
  | { status: "idle"; filesKey: string | null; draft: null; error: null }
  | { status: "preparing" | "uploading"; filesKey: string; draft: null; error: null }
  | { status: "ready"; filesKey: string; draft: HostedEvidenceDraft; error: null }
  | { status: "error"; filesKey: string; draft: null; error: string };

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
  sourceRunId?: string | null;
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
  workspaceContextPack?: GenerationRequest["workspaceContextPack"];
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
  currentPlan?: string;
  savedTemplates?: SavedTemplateOption[];
  defaultTemplateId?: string | null;
  recipePrefill?: RecipePrefill;
  startTour?: boolean;
  startWithSampleData?: boolean;
  templateFeeReturn?: {
    draftId: string;
    status: "success" | "cancelled";
    sessionId: string | null;
  };
};

type TourRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type TourStepId = (typeof TOUR_STEPS)[number]["id"];

type TourProgressState = {
  selectedReportType: string | null;
  hasEvidence: boolean;
  businessContext: string;
  audience: string;
  objective: string;
  isSubmitting: boolean;
};

const TOUR_AUTO_ADVANCE_DELAY_MS = 600;
const TOUR_STEPS = [
  {
    id: "report-type",
    formStep: 0,
    title: "Start with the closest report type.",
    copy: "This is only a shortcut. Pick the closest shape and keep moving. You can still rewrite everything later.",
  },
  {
    id: "upload",
    formStep: 1,
    title: "Drop the files behind one real review.",
    copy: "Start with the workbook or CSV you already use. Add PDFs or slides only if they add useful context.",
  },
  {
    id: "business-context",
    formStep: 2,
    title: "Explain what changed.",
    copy: "One or two concrete sentences are enough. Numbers, timing, and pressure points beat long generic background.",
  },
  {
    id: "audience-objective",
    formStep: 2,
    title: "Name the audience and the decision.",
    copy: "Say who this is for and what the deck should help decide. That is what sharpens the narrative.",
  },
  {
    id: "review",
    formStep: 3,
    title: "Set the depth, then generate.",
    copy: "Do a quick final pass here, choose the output depth, and launch the run when the brief feels tight.",
  },
] as const;

export function GenerationForm({
  currentPlan = "free",
  savedTemplates = [],
  defaultTemplateId = null,
  recipePrefill,
  startTour = false,
  startWithSampleData = false,
  templateFeeReturn,
}: GenerationFormProps) {
  const router = useRouter();
  const planSlideCap = currentPlan === "unlimited" ? MAX_TARGET_SLIDES : STANDARD_PLAN_MAX_TARGET_SLIDES;
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  const reportTypeRef = useRef<HTMLElement | null>(null);
  const uploadStepRef = useRef<HTMLElement | null>(null);
  const businessContextRef = useRef<HTMLLabelElement | null>(null);
  const audienceObjectiveRef = useRef<HTMLDivElement | null>(null);
  const reviewStepRef = useRef<HTMLElement | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateFeeMessage, setTemplateFeeMessage] = useState<string | null>(
    templateFeeReturn?.status === "cancelled"
      ? "Template fee checkout was cancelled. Your prepared draft is still loaded below."
      : null,
  );
  const [creditPreview, setCreditPreview] = useState<CreditPreview | null>(null);
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
  const [targetSlideCount, setTargetSlideCount] = useState(
    clampTargetSlideCount(recipePrefill?.targetSlideCount ?? 10, planSlideCap),
  );
  const [selectedModel, setSelectedModel] = useState<AuthorModel>(
    MODEL_OPTIONS.some((option) => option.id === recipePrefill?.authorModel)
      ? (recipePrefill?.authorModel as AuthorModel)
      : DEFAULT_AUTHOR_MODEL,
  );
  const isReportOnlyTier = selectedModel === "claude-haiku-4-5";
  const requiresTemplateFee = currentPlan === "free" && selectedTemplateId !== null;
  const creditsNeeded = isReportOnlyTier ? 3 : calculateRunCredits(targetSlideCount, selectedModel);
  const creditShortfall = creditPreview ? Math.max(0, creditsNeeded - creditPreview.balance) : 0;
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
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [tourRect, setTourRect] = useState<TourRect | null>(null);
  const [hostedEvidence, setHostedEvidence] = useState<HostedEvidenceState>({
    status: "idle",
    filesKey: null,
    draft: null,
    error: null,
  });
  const [launchRunId, setLaunchRunId] = useState<string | null>(null);
  const [sampleLoadState, setSampleLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [tourAdvancePendingFor, setTourAdvancePendingFor] = useState<TourStepId | null>(null);
  const sampleLoadTriggeredRef = useRef(false);
  const hasEvidence = evidenceFiles.length > 0 || prefillSourceFiles.length > 0;
  const tourProgressState: TourProgressState = {
    selectedReportType,
    hasEvidence,
    businessContext: brief.businessContext,
    audience: brief.audience,
    objective: brief.objective,
    isSubmitting,
  };
  const activeTourStep = isTourOpen ? TOUR_STEPS[tourIndex] : null;
  const activeTourStepId = activeTourStep?.id ?? null;
  const activeTourStepComplete = activeTourStep ? isTourStepComplete(activeTourStep.id, tourProgressState) : false;
  const refreshCreditPreview = useCallback(async () => {
    const next = await fetchCreditPreview();
    setCreditPreview(next);
    return next;
  }, []);
  const getTourTarget = useCallback((stepId: (typeof TOUR_STEPS)[number]["id"]) => {
    if (stepId === "report-type") return reportTypeRef.current;
    if (stepId === "upload") return uploadStepRef.current;
    if (stepId === "business-context") return businessContextRef.current;
    if (stepId === "audience-objective") return audienceObjectiveRef.current;
    if (stepId === "review") return reviewStepRef.current;
    return null;
  }, []);
  const measureActiveTour = useCallback((step: (typeof TOUR_STEPS)[number]) => {
    if (typeof window === "undefined") {
      return false;
    }

    const target = getTourTarget(step.id);

    if (!target) {
      return false;
    }

    const rect = target.getBoundingClientRect();
    const viewportPadding = 24;
    const isVisible = rect.bottom > viewportPadding && rect.top < window.innerHeight - viewportPadding;

    if (!isVisible) {
      setTourRect(null);
      return false;
    }

    const paddedRect = {
      top: Math.max(12, rect.top - 10),
      left: Math.max(12, rect.left - 10),
      width: rect.width + 20,
      height: rect.height + 20,
    };

    setTourRect((current) => (areTourRectsEqual(current, paddedRect) ? current : paddedRect));

    return true;
  }, [getTourTarget]);

  // Track whether the submit was from the explicit button click
  const submitIntentRef = useRef(false);
  const autoResumeTemplateFeeRef = useRef(false);
  const hostedEvidencePromiseRef = useRef<Promise<HostedEvidenceDraft> | null>(null);
  const hostedEvidenceRequestRef = useRef(0);
  const tourAdvanceTimerRef = useRef<number | null>(null);
  const tourScrollSettleRef = useRef<number | null>(null);

  const clearPendingTourAdvance = useCallback(() => {
    if (typeof window !== "undefined" && tourAdvanceTimerRef.current !== null) {
      window.clearTimeout(tourAdvanceTimerRef.current);
    }
    tourAdvanceTimerRef.current = null;
    setTourAdvancePendingFor(null);
  }, []);

  const clearTourScrollSettle = useCallback(() => {
    if (typeof window !== "undefined" && tourScrollSettleRef.current !== null) {
      window.clearTimeout(tourScrollSettleRef.current);
    }
    tourScrollSettleRef.current = null;
  }, []);

  const moveTourToIndex = useCallback((nextIndex: number) => {
    clearPendingTourAdvance();
    const clampedIndex = Math.max(0, Math.min(TOUR_STEPS.length - 1, nextIndex));
    setTourIndex(clampedIndex);
    setCurrentStep(TOUR_STEPS[clampedIndex].formStep);
  }, [clearPendingTourAdvance]);

  const scheduleTourAdvance = useCallback((expectedStepId: TourStepId, nextIndex: number) => {
    if (typeof window === "undefined") {
      return;
    }

    clearPendingTourAdvance();
    setTourAdvancePendingFor(expectedStepId);
    tourAdvanceTimerRef.current = window.setTimeout(() => {
      setTourIndex((current) => {
        if (!isTourOpen || TOUR_STEPS[current]?.id !== expectedStepId) {
          return current;
        }

        const clampedIndex = Math.max(0, Math.min(TOUR_STEPS.length - 1, nextIndex));
        setCurrentStep(TOUR_STEPS[clampedIndex].formStep);
        return clampedIndex;
      });
      tourAdvanceTimerRef.current = null;
      setTourAdvancePendingFor(null);
    }, TOUR_AUTO_ADVANCE_DELAY_MS);
  }, [clearPendingTourAdvance, isTourOpen]);

  function closeTour(markSeen = true) {
    clearPendingTourAdvance();
    setIsTourOpen(false);
    setTourRect(null);

    if (typeof window !== "undefined" && markSeen) {
      window.localStorage.setItem("basquio:onboarding-tour-seen", "1");
    }
  }

  const openTour = useCallback((fromIndex = 0) => {
    clearPendingTourAdvance();
    setTourIndex(fromIndex);
    setIsTourOpen(true);
  }, [clearPendingTourAdvance]);

  function reserveRunId() {
    const nextRunId = crypto.randomUUID();
    setLaunchRunId(nextRunId);
    return nextRunId;
  }

  const ensureHostedEvidenceReady = useCallback(async (nextFiles = evidenceFiles) => {
    const filesKey = buildFilesKey(nextFiles);
    if (!filesKey) {
      throw new Error("Add at least one supported evidence file before generating.");
    }

    if (hostedEvidence.status === "ready" && hostedEvidence.filesKey === filesKey && hostedEvidence.draft) {
      return hostedEvidence.draft;
    }

    if (
      hostedEvidencePromiseRef.current &&
      (hostedEvidence.status === "preparing" || hostedEvidence.status === "uploading") &&
      hostedEvidence.filesKey === filesKey
    ) {
      return hostedEvidencePromiseRef.current;
    }

    const requestId = hostedEvidenceRequestRef.current + 1;
    hostedEvidenceRequestRef.current = requestId;

    const uploadPromise = (async () => {
      setHostedEvidence({
        status: "preparing",
        filesKey,
        draft: null,
        error: null,
      });

      const prepareResponse = await fetch("/api/uploads/prepare", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId: "local-org",
          projectId: "local-project",
          evidenceFiles: nextFiles.map((file) => ({
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

      setHostedEvidence({
        status: "uploading",
        filesKey,
        draft: null,
        error: null,
      });

      await uploadPreparedFiles(nextFiles, preparePayload.evidenceUploads);

      const draft = {
        jobId: preparePayload.jobId,
        organizationId: preparePayload.organizationId,
        projectId: preparePayload.projectId,
        sourceFiles: preparePayload.evidenceUploads.map(stripUploadTransportFields),
      } satisfies HostedEvidenceDraft;

      if (hostedEvidenceRequestRef.current === requestId) {
        setHostedEvidence({
          status: "ready",
          filesKey,
          draft,
          error: null,
        });
      }

      return draft;
    })();

    hostedEvidencePromiseRef.current = uploadPromise;

    try {
      return await uploadPromise;
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Unable to secure your files.";
      if (hostedEvidenceRequestRef.current === requestId) {
        setHostedEvidence({
          status: "error",
          filesKey,
          draft: null,
          error: message,
        });
      }
      throw uploadError;
    } finally {
      if (hostedEvidencePromiseRef.current === uploadPromise) {
        hostedEvidencePromiseRef.current = null;
      }
    }
  }, [evidenceFiles, hostedEvidence]);

  function launchRun(draft: {
    runId: string;
    sourceRunId?: string;
    authorModel: string;
    templateProfileId: string | null;
    targetSlideCount: number;
    recipeId?: string;
    brief: BriefFields;
    sourceFiles?: Array<NonNullable<GenerationRequest["sourceFiles"]>[number]>;
    existingSourceFileIds?: string[];
    workspaceContextPack?: GenerationRequest["workspaceContextPack"];
  }) {
    saveRunLaunchDraft({
      runId: draft.runId,
      sourceRunId: draft.sourceRunId,
      createdAt: new Date().toISOString(),
      authorModel: draft.authorModel,
      templateProfileId: draft.templateProfileId,
      targetSlideCount: draft.targetSlideCount,
      recipeId: draft.recipeId,
      brief: draft.brief,
      sourceFiles: draft.sourceFiles,
      existingSourceFileIds: draft.existingSourceFileIds,
      workspaceContextPack: draft.workspaceContextPack ?? null,
    });

    startTransition(() => {
      router.push(`/jobs/${draft.runId}`);
    });
  }

  useEffect(() => {
    return () => {
      clearPendingTourAdvance();
      clearTourScrollSettle();
    };
  }, [clearPendingTourAdvance, clearTourScrollSettle]);

  useEffect(() => {
    if (recipePrefill || typeof window === "undefined") {
      return;
    }

    if (startTour) {
      openTour(0);
      return;
    }

    if (!window.localStorage.getItem("basquio:onboarding-tour-seen")) {
      openTour(0);
    }
  }, [openTour, recipePrefill, startTour]);

  useLayoutEffect(() => {
    if (!isTourOpen) {
      return;
    }

    const currentTourStep = TOUR_STEPS[tourIndex];
    const desiredFormStep = currentTourStep.formStep;
    const stepComplete = isTourStepComplete(currentTourStep.id, {
      selectedReportType,
      hasEvidence,
      businessContext: brief.businessContext,
      audience: brief.audience,
      objective: brief.objective,
      isSubmitting,
    });
    const shouldMoveBackward = desiredFormStep < currentStep;
    const shouldMoveForward = desiredFormStep > currentStep && !stepComplete;
    if (shouldMoveBackward || shouldMoveForward) {
      setCurrentStep(desiredFormStep);
    }
  }, [
    currentStep,
    isSubmitting,
    isTourOpen,
    tourIndex,
    brief.audience,
    brief.businessContext,
    brief.objective,
    hasEvidence,
    selectedReportType,
  ]);

  useLayoutEffect(() => {
    if (!isTourOpen || !activeTourStep) {
      return;
    }

    const target = getTourTarget(activeTourStep.id);

    if (!target) {
      return;
    }

    if (typeof window !== "undefined") {
      const rect = target.getBoundingClientRect();
      const viewportPadding = 24;
      const isOutsideViewport = rect.top < viewportPadding || rect.bottom > window.innerHeight - viewportPadding;

      if (isOutsideViewport) {
        target.scrollIntoView({
          block: "center",
          inline: "nearest",
        });
      }
    }

    measureActiveTour(activeTourStep);
    const rafId = window.requestAnimationFrame(() => {
      measureActiveTour(activeTourStep);
    });

    const handleReposition = () => {
      clearTourScrollSettle();
      measureActiveTour(activeTourStep);
    };
    const handleScroll = () => {
      clearTourScrollSettle();
      setTourRect(null);
      tourScrollSettleRef.current = window.setTimeout(() => {
        measureActiveTour(activeTourStep);
        tourScrollSettleRef.current = null;
      }, 120);
    };
    const resizeObserver = new ResizeObserver(() => {
      measureActiveTour(activeTourStep);
    });

    resizeObserver.observe(target);

    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      clearTourScrollSettle();
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [
    currentStep,
    isTourOpen,
    activeTourStep,
    clearTourScrollSettle,
    getTourTarget,
    measureActiveTour,
  ]);

  useEffect(() => {
    if (!templateFeeReturn || templateFeeReturn.status !== "success" || !templateFeeReturn.draftId || autoResumeTemplateFeeRef.current) {
      return;
    }

    autoResumeTemplateFeeRef.current = true;

    if (!templateFeeReturn.sessionId) {
      setError("Template fee payment returned without a Stripe session ID. Retry from /jobs/new.");
      return;
    }
    const sessionId = templateFeeReturn.sessionId;

    setIsSubmitting(true);
    setError(null);
    setTemplateFeeMessage("Template fee paid. Confirming the checkout and resuming your run...");

    void (async () => {
      try {
        await confirmTemplateFeeDraft(templateFeeReturn.draftId, sessionId);
        const payload = await startPaidTemplateRun(templateFeeReturn.draftId);
        router.push(payload.progressUrl);
      } catch (resumeError) {
        setError(resumeError instanceof Error ? resumeError.message : "Unable to resume the paid template run.");
        setIsSubmitting(false);
      }
    })();
  }, [router, templateFeeReturn]);

  useEffect(() => {
    if (currentPlan === "unlimited") {
      setCreditPreview(null);
      return;
    }

    void refreshCreditPreview().catch(() => {});
  }, [currentPlan, refreshCreditPreview]);

  useEffect(() => {
    const filesKey = buildFilesKey(evidenceFiles);

    hostedEvidenceRequestRef.current += 1;
    hostedEvidencePromiseRef.current = null;
    setHostedEvidence((current) => {
      if (!filesKey) {
        return {
          status: "idle",
          filesKey: null,
          draft: null,
          error: null,
        };
      }

      if (current.filesKey === filesKey && current.status === "ready") {
        return current;
      }

      return {
        status: "idle",
        filesKey,
        draft: null,
        error: null,
      };
    });
  }, [evidenceFiles]);

  useEffect(() => {
    if (currentStep < 2 || evidenceFiles.length === 0) {
      return;
    }

    void ensureHostedEvidenceReady().catch(() => {});
  }, [currentStep, ensureHostedEvidenceReady, evidenceFiles]);

  useEffect(() => {
    if (currentStep !== steps.length - 1) {
      return;
    }

    const runId = launchRunId ?? reserveRunId();
    router.prefetch(`/jobs/${runId}`);
  }, [currentStep, launchRunId, router]);

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
      if (isTourOpen && activeTourStepId === "review" && !hasEvidence) {
        setError("Add a file first. Upload evidence or try the sample dataset, then Basquio can launch the run.");
        setCurrentStep(1);
        setTourIndex(1);
        return;
      }

      validateSubmission(evidenceFiles, brief, prefillSourceFiles.length);
      const effectiveTargetSlideCount = isReportOnlyTier ? 1 : targetSlideCount;

      if (requiresTemplateFee && selectedTemplateId) {
        const latestCredits = await refreshCreditPreview();
        if (latestCredits && latestCredits.balance < creditsNeeded) {
          setError(
            `This ${isReportOnlyTier ? "report" : `${effectiveTargetSlideCount}-slide deck`} needs ${creditsNeeded} credits, but you only have ${latestCredits.balance}. Buy credits before paying the custom-template fee.`,
          );
          return;
        }

        let draftId: string;
        let draftStatus: TemplateFeeDraftResponse["status"] = "pending_payment";

        if (prefillSourceFiles.length > 0 && evidenceFiles.length === 0) {
          const draftResult = await createTemplateFeeDraft({
            templateProfileId: selectedTemplateId,
            existingSourceFileIds: prefillSourceFiles.map((sf) => sf.id),
            targetSlideCount: effectiveTargetSlideCount,
            authorModel: selectedModel,
            recipeId: recipePrefill?.recipeId ?? undefined,
            brief,
          });
          draftId = draftResult.draftId;
          draftStatus = draftResult.status;
        } else {
          const hostedDraft = await ensureHostedEvidenceReady();

          const draftResult = await createTemplateFeeDraft({
            templateProfileId: selectedTemplateId,
            sourceFiles: hostedDraft.sourceFiles,
            targetSlideCount: effectiveTargetSlideCount,
            authorModel: selectedModel,
            recipeId: recipePrefill?.recipeId ?? undefined,
            brief,
          });
          draftId = draftResult.draftId;
          draftStatus = draftResult.status;
        }

        if (draftStatus === "paid") {
          setTemplateFeeMessage("Custom template already unlocked for this run. Resuming without another payment...");
          const payload = await startPaidTemplateRun(draftId);
          router.push(payload.progressUrl);
          return;
        }

        setTemplateFeeMessage("Redirecting to Stripe to unlock the custom template for this run...");
        const checkout = await startTemplateFeeCheckout(selectedTemplateId, draftId);
        if (checkout.status >= 400 || !checkout.url) {
          throw new Error(checkout.error ?? "Template fee checkout failed.");
        }
        if (isTourOpen) {
          closeTour();
        }
        window.location.href = checkout.url;
        return;
      }

      const runId = launchRunId ?? reserveRunId();

      if (prefillSourceFiles.length > 0 && evidenceFiles.length === 0) {
        if (isTourOpen) {
          closeTour();
        }
        launchRun({
          runId,
          sourceRunId: recipePrefill?.sourceRunId ?? undefined,
          authorModel: selectedModel,
          templateProfileId: selectedTemplateId,
          targetSlideCount: effectiveTargetSlideCount,
          recipeId: recipePrefill?.recipeId ?? undefined,
          brief,
          workspaceContextPack: recipePrefill?.workspaceContextPack,
          existingSourceFileIds: prefillSourceFiles.map((sf) => sf.id),
        });
        return;
      }

      if (isTourOpen) {
        closeTour();
      }

      const hostedDraft = await ensureHostedEvidenceReady();
      launchRun({
        runId,
        sourceRunId: recipePrefill?.sourceRunId ?? undefined,
        authorModel: selectedModel,
        templateProfileId: selectedTemplateId,
        targetSlideCount: effectiveTargetSlideCount,
        recipeId: recipePrefill?.recipeId ?? undefined,
        brief,
        workspaceContextPack: recipePrefill?.workspaceContextPack,
        sourceFiles: hostedDraft.sourceFiles,
      });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Generation failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function selectReportType(presetId: string) {
    clearPendingTourAdvance();
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
    if (isTourOpen && activeTourStepId === "report-type") {
      moveTourToIndex(1);
      return;
    }

    setCurrentStep(1);
  }

  function goToNextStep() {
    if (currentStep === 0) {
      // Report type step — skip to upload even without selection
      setError(null);
      if (isTourOpen) {
        moveTourToIndex(1);
        return;
      }
      setCurrentStep(1);
      return;
    }

    if (currentStep === 1 && evidenceFiles.length === 0 && prefillSourceFiles.length === 0) {
      setError("Add at least one supported evidence file before continuing.");
      return;
    }

    if (currentStep === 2) {
      if (isTourOpen && activeTourStepId === "business-context") {
        if (brief.businessContext.trim().length < 10) {
          setError("Add a concrete business context before continuing.");
          return;
        }
        setError(null);
        moveTourToIndex(3);
        return;
      }

      if (isTourOpen && activeTourStepId === "audience-objective") {
        if (!brief.audience.trim() || !brief.objective.trim()) {
          setError("Add both the audience and objective before continuing.");
          return;
        }
        setError(null);
        moveTourToIndex(4);
        return;
      }

      if (!brief.businessContext || !brief.audience || !brief.objective) {
        setError("Add the business context, audience, and objective before continuing.");
        return;
      }
    }

    setError(null);
    if (isTourOpen && activeTourStepId) {
      if (activeTourStepId === "upload") {
        moveTourToIndex(2);
        return;
      }
      if (activeTourStepId === "business-context") {
        moveTourToIndex(3);
        return;
      }
      if (activeTourStepId === "audience-objective") {
        moveTourToIndex(4);
        return;
      }
    }
    setCurrentStep((step) => Math.min(step + 1, steps.length - 1));
  }

  function goToPreviousStep() {
    setError(null);
    clearPendingTourAdvance();
    if (isTourOpen) {
      moveTourToIndex(tourIndex - 1);
      return;
    }
    setCurrentStep((step) => Math.max(step - 1, 0));
  }

  function openEvidencePicker() {
    evidenceInputRef.current?.click();
  }

  function updateEvidenceFiles(files: File[]) {
    clearPendingTourAdvance();
    setEvidenceFiles((current) => {
      const merged = mergeFiles(current, files);
      syncInputFiles(evidenceInputRef.current, merged);
      return merged;
    });
    setError(null);

    if (isTourOpen && activeTourStepId === "upload" && !hasEvidence && files.length > 0) {
      scheduleTourAdvance("upload", 2);
    }
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
    clearPendingTourAdvance();
    const nextBrief = {
      ...brief,
      [field]: value,
    };
    setBrief(nextBrief);
    setError(null);

    if (isTourOpen && activeTourStepId === "business-context" && field === "businessContext") {
      const previousComplete = brief.businessContext.trim().length >= 10;
      const nextComplete = nextBrief.businessContext.trim().length >= 10;

      if (!previousComplete && nextComplete) {
        scheduleTourAdvance("business-context", 3);
      }
      return;
    }

    if (isTourOpen && activeTourStepId === "audience-objective" && (field === "audience" || field === "objective")) {
      const previousComplete = brief.audience.trim().length > 0 && brief.objective.trim().length > 0;
      const nextComplete = nextBrief.audience.trim().length > 0 && nextBrief.objective.trim().length > 0;

      if (!previousComplete && nextComplete) {
        scheduleTourAdvance("audience-objective", 4);
      }
    }
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDraggingEvidence(false);
    updateEvidenceFiles(Array.from(event.dataTransfer.files ?? []));
  }

  const loadSampleDataset = useCallback(async () => {
    setSampleLoadState("loading");
    setError(null);

    try {
      const response = await fetch(SAMPLE_DATASET_URL, { cache: "force-cache" });
      if (!response.ok) {
        throw new Error("Sample dataset is unavailable right now.");
      }

      const blob = await response.blob();
      const file = new File([blob], SAMPLE_DATASET_FILE_NAME, {
        type: "text/csv",
        lastModified: Date.now(),
      });

      setEvidenceFiles([file]);
      clearPendingTourAdvance();
      syncInputFiles(evidenceInputRef.current, [file]);
      setBrief((current) => ({
        businessContext: current.businessContext || SAMPLE_BRIEF.businessContext,
        client: current.client,
        audience: current.audience || SAMPLE_BRIEF.audience,
        objective: current.objective || SAMPLE_BRIEF.objective,
        thesis: current.thesis || SAMPLE_BRIEF.thesis,
        stakes: current.stakes || SAMPLE_BRIEF.stakes,
      }));
      setCurrentStep((step) => Math.max(step, 1));
      setSampleLoadState("ready");

      if (isTourOpen && activeTourStepId === "upload" && !hasEvidence) {
        scheduleTourAdvance("upload", 2);
      }
    } catch (sampleError) {
      setSampleLoadState("error");
      setError(sampleError instanceof Error ? sampleError.message : "Unable to load the sample dataset.");
    }
  }, [activeTourStepId, clearPendingTourAdvance, hasEvidence, isTourOpen, scheduleTourAdvance]);

  useEffect(() => {
    if (!startWithSampleData || sampleLoadTriggeredRef.current || recipePrefill || prefillSourceFiles.length > 0 || evidenceFiles.length > 0) {
      return;
    }

    sampleLoadTriggeredRef.current = true;
    void loadSampleDataset();
  }, [evidenceFiles.length, loadSampleDataset, prefillSourceFiles.length, recipePrefill, startWithSampleData]);

  return (
    <div className="stack-lg">
      <form className="panel form-shell stack-xl" onSubmit={handleSubmit}>
        <div className="form-tour-bar">
          <div className="stack-xs">
            <p className="section-label">
              Guided setup
              <InfoHint>
                Follow the four steps directly, or use the tour if you want Basquio to walk you through the flow.
              </InfoHint>
            </p>
          </div>
          <button className="button small secondary" type="button" onClick={() => openTour(0)}>
            Start tour
          </button>
        </div>

        <div className="stepper-track" aria-label="Analysis setup steps">
          {steps.map((step, index) => {
            const state =
              index === currentStep ? "active" : index < currentStep ? "done" : "upcoming";

            return (
              <button
                key={step.id}
                className={`step-chip step-chip-${state}`}
                type="button"
                onClick={() => {
                  clearPendingTourAdvance();
                  setCurrentStep(index);
                  if (isTourOpen) {
                    setTourIndex(getTourIndexForFormStep(index, tourIndex));
                  }
                }}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{step.title}</strong>
              </button>
            );
          })}
        </div>

        {currentStep === 0 ? (
          <section
            ref={reportTypeRef}
            className={`step-panel stack-lg${activeTourStepId === "report-type" ? " tour-target-active" : ""}${activeTourStepId === "report-type" && activeTourStepComplete ? " tour-target-complete" : ""}`}
          >
            <div className="stack-xs">
              <p className="section-label">Step 1</p>
              <h2>
                What kind of report?
                <InfoHint>
                  Pick the closest starting shape. It only pre-fills the brief. You can still rewrite everything.
                </InfoHint>
              </h2>
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
          <section
            ref={uploadStepRef}
            className={`step-panel stack-lg${activeTourStepId === "upload" ? " tour-target-active" : ""}${activeTourStepId === "upload" && activeTourStepComplete ? " tour-target-complete" : ""}`}
          >
            <div className="stack-xs">
              <p className="section-label">Step 2</p>
              <h2>
                Upload your evidence
                <InfoHint>
                  Start with the workbook or CSV behind the review. Add slides or PDFs only if they add useful context.
                </InfoHint>
              </h2>
            </div>

            <div
              className={`panel${activeTourStepId === "upload" ? " tour-sample-callout-active" : ""}${activeTourStepId === "upload" && activeTourStepComplete ? " tour-target-complete" : ""}`}
              style={{ padding: "1rem 1.1rem", background: "rgba(26,106,255,0.04)", borderColor: "rgba(26,106,255,0.16)" }}
            >
              <div className="setup-inline-head">
                <p className="section-label" style={{ marginBottom: 0 }}>
                  No data ready?
                  <InfoHint>
                    Loads an anonymized sample file and a ready-made brief so you can test the full flow first.
                  </InfoHint>
                </p>
                <h3 style={{ margin: 0 }}>Try the sample dataset</h3>
              </div>
              <div className="row" style={{ marginTop: "0.9rem", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                <button
                  className={`button small secondary${activeTourStepId === "upload" ? " tour-sample-button" : ""}`}
                  type="button"
                  onClick={() => void loadSampleDataset()}
                  disabled={sampleLoadState === "loading"}
                >
                  {sampleLoadState === "loading" ? "Loading sample..." : "Try with sample data"}
                </button>
                <span className="muted" style={{ fontSize: "0.82rem" }}>
                  {sampleLoadState === "ready"
                    ? "Sample loaded"
                    : "One click"}
                </span>
              </div>
            </div>

            <div className="step-grid">
              <div className="stack">
                <button
                  className={`${isDraggingEvidence ? "dropzone dropzone-active" : "dropzone"}${activeTourStepId === "upload" ? " tour-dropzone-active" : ""}${activeTourStepId === "upload" && activeTourStepComplete ? " tour-target-complete" : ""}`}
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
                  <span className="dropzone-copy">CSV, XLSX, PPTX, PDF, DOCX, text, JSON, CSS, or images.</span>
                </button>
                <p className="upload-trust-note">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256" aria-hidden><path d="M128,112a28,28,0,0,0-8,54.83V184a8,8,0,0,0,16,0V166.83A28,28,0,0,0,128,112Zm0,40a12,12,0,1,1,12-12A12,12,0,0,1,128,152Zm80-72H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96ZM208,208H48V96H208V208Z"></path></svg>
                  Encrypted.
                  <InfoHint>
                    Your files are not used for model training. <a href="/security">Learn more</a>
                  </InfoHint>
                </p>

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
                  <p className="section-label">
                    Template
                    <InfoHint>
                      Choose the design system for this run. Basquio Standard is the default. Saved templates apply your own look.
                    </InfoHint>
                  </p>
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
                  {requiresTemplateFee ? (
                    <p className="template-selection-summary">
                      Custom template: $5 one-time unlock
                    </p>
                  ) : null}
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
              <h2>
                Describe the brief
                <InfoHint>
                  Keep it short. One business problem, one audience, one decision. That is enough for a strong first run.
                </InfoHint>
              </h2>
            </div>

            <div className="form-grid brief-form-grid">
              <label
                ref={businessContextRef}
                className={`field field-span-2${activeTourStepId === "business-context" ? " tour-target-active" : ""}${activeTourStepId === "business-context" && activeTourStepComplete ? " tour-target-complete" : ""}`}
              >
                <span>
                  Business context
                  <InfoHint>What changed? One or two concrete sentences with timing, pressure, or numbers.</InfoHint>
                </span>
                <textarea
                  name="businessContext"
                  value={brief.businessContext}
                  rows={6}
                  placeholder="Example: We lost 1.2pp share in Modern Trade over the last 52 weeks while the category grew."
                  onChange={(event) => updateBriefField("businessContext", event.target.value)}
                />
              </label>

              <div
                ref={audienceObjectiveRef}
                className={`form-grid field-span-2 compact-brief-grid${activeTourStepId === "audience-objective" ? " tour-target-active" : ""}${activeTourStepId === "audience-objective" && activeTourStepComplete ? " tour-target-complete" : ""}`}
              >
                <label className="field">
                  <span>
                    Audience
                    <InfoHint>Role plus company or meeting context.</InfoHint>
                  </span>
                  <input
                    name="audience"
                    value={brief.audience}
                    placeholder="VP Commercial for the QBR"
                    onChange={(event) => updateBriefField("audience", event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>
                    Objective
                    <InfoHint>The decision this deck should help make.</InfoHint>
                  </span>
                  <input
                    name="objective"
                    value={brief.objective}
                    placeholder="Diagnose the cause and recommend 3 actions"
                    onChange={(event) => updateBriefField("objective", event.target.value)}
                  />
                </label>
              </div>

              <details className="field-span-2 brief-optional-details">
                <summary>Optional: thesis, client, and stakes</summary>

                <div className="form-grid">
                  <label className="field">
                    <span>
                      Client
                      <InfoHint>Only useful if the deck is client-facing.</InfoHint>
                    </span>
                    <input
                      name="client"
                      value={brief.client}
                      placeholder="Optional"
                      onChange={(event) => updateBriefField("client", event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>
                      Thesis
                      <InfoHint>Your current point of view before Basquio sharpens it.</InfoHint>
                    </span>
                    <input
                      name="thesis"
                      value={brief.thesis}
                      placeholder="Optional working point of view"
                      onChange={(event) => updateBriefField("thesis", event.target.value)}
                    />
                  </label>

                  <label className="field field-span-2">
                    <span>
                      Stakes
                      <InfoHint>Why this matters now.</InfoHint>
                    </span>
                    <textarea
                      name="stakes"
                      value={brief.stakes}
                      rows={4}
                      placeholder="Optional: budget review, retailer negotiation, board meeting..."
                      onChange={(event) => updateBriefField("stakes", event.target.value)}
                    />
                  </label>
                </div>
              </details>

              <details className="field-span-2 brief-optional-details">
                <summary>See a strong example</summary>
                <div className="brief-example-card">
                  <p><strong>Context</strong> {BRIEF_EXAMPLE.businessContext}</p>
                  <p><strong>Audience</strong> {BRIEF_EXAMPLE.audience}</p>
                  <p><strong>Objective</strong> {BRIEF_EXAMPLE.objective}</p>
                  <p><strong>Thesis</strong> {BRIEF_EXAMPLE.thesis}</p>
                  <p><strong>Stakes</strong> {BRIEF_EXAMPLE.stakes}</p>
                </div>
              </details>
            </div>
          </section>
        ) : null}

        {currentStep === 3 ? (
          <section
            ref={reviewStepRef}
            className={`step-panel stack-lg${activeTourStepId === "review" ? " tour-target-active" : ""}${activeTourStepId === "review" && activeTourStepComplete ? " tour-target-complete" : ""}`}
          >
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
                {evidenceFiles.length > 0 ? (
                  <p className="muted" style={{ fontSize: "0.82rem" }}>
                    {hostedEvidence.status === "ready"
                      ? "Files secured"
                      : hostedEvidence.status === "preparing" || hostedEvidence.status === "uploading"
                        ? "Securing files"
                        : hostedEvidence.status === "error"
                          ? hostedEvidence.error
                          : "Files will be secured before launch"}
                  </p>
                ) : null}
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
                <p className="muted">{selectedTemplate ? "Saved template" : "Basquio Standard"}</p>
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
                  <p className="section-label" style={{ marginBottom: 0 }}>
                    Model
                    <InfoHint>Choose the depth of the output. Memo skips slides. Deck and Deep-Dive generate slides, report, and data.</InfoHint>
                  </p>
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
                        max={planSlideCap}
                        value={targetSlideCount}
                        onChange={(e) => setTargetSlideCount(clampTargetSlideCount(Number(e.target.value), planSlideCap))}
                        style={{ width: "100%", accentColor: "var(--blue)" }}
                      />
                      <span className="muted" style={{ fontSize: "0.78rem", display: "flex", justifyContent: "space-between" }}>
                        <span>3 slides (6 cr)</span>
                        <span>{planSlideCap} slides</span>
                      </span>
                    </label>
                  </div>
                ) : (
                  <p className="muted" style={{ fontSize: "0.82rem" }}>
                    This tier generates an analytical report and data pack. No presentation slides.
                  </p>
                )}
                {currentPlan !== "unlimited" ? (
                  <div className={`panel ${creditShortfall > 0 ? "warning-panel" : "success-panel"}`} style={{ marginTop: "0.5rem" }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>
                      {creditPreview
                        ? `You have ${creditPreview.balance} credits available.`
                        : "Checking your available credits..."}
                    </p>
                    {creditPreview ? (
                      <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
                        {creditShortfall > 0
                          ? `This run is short by ${creditShortfall} credits.${requiresTemplateFee ? " Buy credits before paying the custom-template fee." : ""}`
                          : "You can afford this run with your current balance."}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {requiresTemplateFee ? (
                  <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>
                    Custom template fee: $5 one-time checkout for this prepared run. It does not include credits.
                  </p>
                ) : null}
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
                className={`button${activeTourStepId === "review" ? " tour-generate-button" : ""}`}
                type="submit"
                disabled={isSubmitting}
                onClick={() => { submitIntentRef.current = true; }}
              >
                {isSubmitting ? "Opening run..." : "Build my report"}
              </button>
            )}
          </div>

          <p className="fine-print">Basquio computes the numbers before it writes the story.</p>
        </div>
      </form>

      {error ? <div className="panel danger-panel">{error}</div> : null}
      {templateFeeMessage ? <div className="panel success-panel">{templateFeeMessage}</div> : null}

      {isTourOpen ? (
        <div className="tour-overlay" aria-hidden="true">
          {tourRect ? (
            <div
              className={`tour-spotlight${activeTourStepComplete ? " tour-spotlight-complete" : ""}`}
              style={{
                top: `${tourRect.top}px`,
                left: `${tourRect.left}px`,
                width: `${tourRect.width}px`,
                height: `${tourRect.height}px`,
              }}
            />
          ) : null}

          <div
            className={`tour-card panel${activeTourStepComplete ? " tour-card-complete" : ""}`}
            role="dialog"
            aria-label="Guided setup"
          >
            <div className="tour-card-head">
              <span>{String(tourIndex + 1).padStart(2, "0")} / {String(TOUR_STEPS.length).padStart(2, "0")}</span>
              <button className="tour-close-button" type="button" onClick={() => closeTour()}>
                Skip
              </button>
            </div>
            <div className="stack-xs">
              <h3>{TOUR_STEPS[tourIndex].title}</h3>
              <p>{TOUR_STEPS[tourIndex].copy}</p>
            </div>
            <div className="tour-card-status">
              <span className="tour-card-status-badge" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <path d="M3.5 8.5 6.5 11.5 12.5 4.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <strong>
                {activeTourStepId === "review"
                  ? "Launch the run when this looks right."
                  : tourAdvancePendingFor === activeTourStepId
                    ? "Nice. Moving to the next step..."
                    : activeTourStepComplete
                      ? "This step looks good. Use Next or keep editing."
                    : "Complete this step and the tour moves on automatically."}
              </strong>
            </div>
            <div className="tour-card-actions">
              <button
                className="button small secondary"
                type="button"
                onClick={() => {
                  moveTourToIndex(tourIndex - 1);
                }}
                disabled={tourIndex === 0}
              >
                Back
              </button>
              <button
                className="button small"
                type="button"
                onClick={() => {
                  if (tourIndex === TOUR_STEPS.length - 1) {
                    closeTour();
                    return;
                  }
                  moveTourToIndex(tourIndex + 1);
                }}
              >
                {tourIndex === TOUR_STEPS.length - 1 ? "Done" : "Next"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isTourStepComplete(stepId: TourStepId, state: TourProgressState) {
  if (stepId === "report-type") {
    return Boolean(state.selectedReportType);
  }

  if (stepId === "upload") {
    return state.hasEvidence;
  }

  if (stepId === "business-context") {
    return state.businessContext.trim().length >= 10;
  }

  if (stepId === "audience-objective") {
    return state.audience.trim().length > 0 && state.objective.trim().length > 0;
  }

  if (stepId === "review") {
    return state.isSubmitting;
  }

  return false;
}

function areTourRectsEqual(current: TourRect | null, next: TourRect) {
  if (!current) {
    return false;
  }

  return (
    Math.round(current.top) === Math.round(next.top) &&
    Math.round(current.left) === Math.round(next.left) &&
    Math.round(current.width) === Math.round(next.width) &&
    Math.round(current.height) === Math.round(next.height)
  );
}

function InfoHint({ children }: { children: ReactNode }) {
  return (
    <span className="setup-info-hint">
      <span className="setup-info-trigger" tabIndex={0} aria-label="More information">
        i
      </span>
      <span className="setup-info-bubble" role="tooltip">
        {children}
      </span>
    </span>
  );
}

function getTourIndexForFormStep(formStep: number, currentTourIndex: number) {
  const matchingIndexes = TOUR_STEPS.map((step, index) => ({ step, index }))
    .filter(({ step }) => step.formStep === formStep)
    .map(({ index }) => index);

  if (matchingIndexes.length === 0) {
    return currentTourIndex;
  }

  return matchingIndexes.reduce((closest, index) => {
    return Math.abs(index - currentTourIndex) < Math.abs(closest - currentTourIndex) ? index : closest;
  }, matchingIndexes[0]);
}

function clampTargetSlideCount(value: number, maxSlides: number) {
  if (!Number.isFinite(value)) {
    return 10;
  }

  return Math.min(maxSlides, Math.max(UI_MIN_TARGET_SLIDES, Math.round(value)));
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

function buildFilesKey(files: File[]) {
  if (files.length === 0) {
    return null;
  }

  return files.map(makeFileKey).join("|");
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

async function fetchCreditPreview() {
  const response = await fetch("/api/credits", { cache: "no-store" });
  const payload = (await readApiPayload(response)) as { balance?: number; error?: string };
  if (!response.ok || typeof payload.balance !== "number") {
    throw new Error(payload.error ?? "Unable to load your credit balance.");
  }
  return { balance: payload.balance } satisfies CreditPreview;
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

async function createTemplateFeeDraft(input: {
  templateProfileId: string;
  sourceFiles?: Array<ReturnType<typeof stripUploadTransportFields>>;
  existingSourceFileIds?: string[];
  brief: BriefFields;
  targetSlideCount: number;
  authorModel: AuthorModel;
  recipeId?: string;
}) {
  const response = await fetch("/api/template-fee-drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  const payload = (await readApiPayload(response)) as TemplateFeeDraftResponse & { error?: string };
  if (!response.ok || !payload.draftId || (payload.status !== "pending_payment" && payload.status !== "paid")) {
    throw new Error(payload.error ?? "Failed to prepare the custom-template draft.");
  }

  return payload;
}

async function startTemplateFeeCheckout(templateProfileId: string, draftId: string) {
  const response = await fetch("/api/stripe/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "template_fee", templateProfileId, draftId }),
  });

  const payload = (await readApiPayload(response)) as { url?: string; error?: string };
  return { ...payload, status: response.status };
}

async function confirmTemplateFeeDraft(draftId: string, sessionId: string) {
  const confirmResponse = await fetch("/api/template-fee-drafts/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draftId,
      sessionId,
    }),
  });
  const confirmPayload = (await readApiPayload(confirmResponse)) as { error?: string };
  if (!confirmResponse.ok) {
    throw new Error(confirmPayload.error ?? "Template fee confirmation failed.");
  }
}

async function startPaidTemplateRun(draftId: string) {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draftId,
      jobId: draftId,
    }),
  });
  const payload = await readGenerationPayload(response);
  if (!response.ok) {
    throw new Error(payload.error ?? "Generation failed.");
  }
  return payload;
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

function stripUploadTransportFields(upload: PreparedUpload): NonNullable<GenerationRequest["sourceFiles"]>[number] {
  return {
    id: upload.id,
    fileName: upload.fileName,
    mediaType: upload.mediaType,
    kind: upload.kind as NonNullable<GenerationRequest["sourceFiles"]>[number]["kind"],
    storageBucket: upload.storageBucket,
    storagePath: upload.storagePath,
    fileBytes: upload.fileBytes,
  };
}
