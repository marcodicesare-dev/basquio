export type FidelityMetricsInput = Array<{ label: string; value: string; delta?: string }>;

export type FidelityChartInput = {
  chartType?: string;
  title?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  bubbleSizeLabel?: string;
  excelSheetName?: string;
  dataSignature?: string;
  sourceNote?: string;
};

export type FidelitySlideInput = {
  position: number;
  title: string;
  layoutId?: string;
  slideArchetype?: string;
  body?: string;
  bullets?: string[];
  callout?: { text?: string };
  metrics?: FidelityMetricsInput;
  evidenceIds?: string[];
  pageIntent?: string;
  hasDataTable?: boolean;
  chart?: FidelityChartInput;
};

export type FidelitySheetInput = {
  name: string;
  headers: string[];
  rows: Array<Record<string, unknown>>;
  numericValues: number[];
  dataSignature: string;
};

export type FidelityViolation = {
  rule: string;
  severity: "critical" | "major" | "minor";
  position: number;
  message: string;
};

export type FidelityLintResult = {
  passed: boolean;
  violations: FidelityViolation[];
};

export type TitleNumberToken = {
  raw: string;
  value: number;
  unit: string;
};
