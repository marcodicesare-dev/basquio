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
  createAuthorAgent,
  runAuthorAgent,
  createCriticAgent,
  runCriticAgent,
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
} from "./tools";
