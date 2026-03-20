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
  type QuestionType,
  type ExhibitType,
  type UnitContract,
  type CanonicalColumn,
  type SlideQualityResult,
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
