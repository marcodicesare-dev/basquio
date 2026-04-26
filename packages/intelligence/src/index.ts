// ─── V1 EXPORTS (legacy, will be removed in Phase 4) ─────────────
export { computeAnalytics } from "./analytics";
export { planMetrics } from "./metrics";
export { rankInsights } from "./insights";
export { interpretPackageSemantics } from "./semantics";
export { planSlides } from "./slides";
export { planReportOutline, planStory } from "./story";
export { profileDataset } from "./utils";
export {
  combineValidationReports,
  critiqueExecutionPlanSemantically,
  decideRevision,
  runDeterministicValidation,
} from "./validate";

// ─── V2 EXPORTS (AI-native agents + tools) ───────────────────────
export {
  createAnalystAgent,
  runAnalystAgent,
  type AnalystResult,
  createAuthorAgent,
  runAuthorAgent,
  createCriticAgent,
  runCriticAgent,
  runStrategicCriticAgent,
  type StrategicCriticInput,
} from "./agents";

export {
  createListFilesTool,
  createDescribeTableTool,
  createSampleRowsTool,
  createQueryDataTool,
  createComputeMetricTool,
  createReadSupportDocTool,
  createInspectTemplateTool,
  createInspectBrandTokensTool,
  createBuildChartTool,
  createWriteSlideTool,
  createRenderDeckPreviewTool,
  createVerifyClaimTool,
  createCheckNumericTool,
  createCompareToBriefTool,
  createExportArtifactsTool,
  createQaArtifactsTool,
  detectLanguage,
} from "./tools";

export {
  enforceExhibit,
  inferQuestionType,
  evaluateSlideQuality,
  filterSlidesByQuality,
  mapColumns,
  inferUnitContract,
  findBestExhibitFamily,
  NIQ_EXHIBIT_FAMILIES,
  type QuestionType,
  type ExhibitType,
  type UnitContract,
  type CanonicalColumn,
  type SlideQualityResult,
  type NiqExhibitFamily,
  detectDiagnosticMotifs,
  type DiagnosticMotif,
  type DetectedMotif,
} from "./domain-contracts";

export {
  buildDomainKnowledgeContext,
  scoreDomainKnowledgePacks,
  type DomainKnowledgeStage,
  type DomainKnowledgePackId,
} from "./domain-knowledge";

export {
  resolveColumns,
  resolveColumnValue,
  resolveColumnKey,
  buildColumnReport,
  type ColumnRegistry,
  type ColumnRegistryEntry,
  type ResolvedColumn,
} from "./column-registry";

// ─── WRITING LINTER (deterministic text quality validation) ───────
export {
  lintSlideText,
  lintDeckText,
  type SlideTextInput,
  type LintResult,
  type LintViolation,
  type DeckLintResult,
} from "./writing-linter";

export {
  lintSlidePlan,
  type SlidePlanLintInput,
  type SlidePlanPairViolation,
  type SlidePlanDeckViolation,
  type SlidePlanLintResult,
} from "./slide-plan-linter";

export {
  lintDeckFidelity,
  type FidelityChartInput,
  type FidelityLintResult,
  type FidelitySheetInput,
  type FidelitySlideInput,
  type FidelityViolation,
} from "./fidelity-validators";

export { validateSourceLabels } from "./source-label-validator";
export { validatePeriodOrdering } from "./period-order-validator";
export { validateBubbleLegend } from "./bubble-size-legend-validator";
export { validateTitleClaims } from "./title-claim-verifier";
export { validateChartRepetition } from "./chart-repetition-validator";
export { validateEntityGrounding } from "./entity-grounding-validator";
export { validateRequiredDeltaColumns } from "./required-delta-validator";
export { validateBarOrdering } from "./bar-order-validator";
export { validateSingleSourceLine } from "./source-line-validator";

// ─── FMCG SEMANTIC LAYER (executable domain logic) ────────────────
export {
  routeQuestion,
  getRequiredDerivatives,
  validateSlideEvidence,
  getLeversForRoute,
  DERIVED_METRICS,
  QUESTION_ROUTES,
  RECOMMENDATION_LEVERS,
  type QuestionRoute,
  type DerivedMetricProgram,
  type RecommendationLever,
  type FmcgDomain,
  type FmcgMeasure,
} from "./fmcg-semantic-layer";

// ─── EVAL HARNESS (benchmark scoring framework) ──────────────────
export {
  scoreWritingQuality,
  scoreVisualQuality,
  scoreCost,
  scoreEvidenceLinkage,
  aggregateEvals,
  EVAL_THRESHOLDS,
  BENCHMARK_CASES,
  type EvalDimension,
  type EvalScore,
  type RunEval,
  type BenchmarkCase,
} from "./eval-harness";

// ─── RENDERING CONTRACT (constrained compatibility surface) ───────
export {
  SUPPORTED_LAYOUTS,
  SAFE_CHART_TYPES,
  IMAGE_ONLY_CHART_TYPES,
  OOXML_RULES,
  MIN_REQUIRED_STRUCTURAL_DECK_SLIDES,
  MAX_RENDERING_TARGET_SLIDES,
  SAFE_FONTS,
  validateSlideContract,
  validateDeckContract,
  coerceToSafeChartType,
  isSupportedLayout,
  isSafeChartType,
  isImageOnlyChartType,
  requiresImageRender,
  type SupportedLayout,
  type SafeChartType,
  type ContractViolation,
} from "./rendering-contract";
