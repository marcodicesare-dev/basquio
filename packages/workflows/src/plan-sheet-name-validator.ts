import type { DatasetProfile } from "@basquio/types";

export type PlanSheetNameReport = {
  valid: boolean;
  fabricatedSheetNames: Array<{
    slidePosition: number;
    chartId: string;
    claimedSheetName: string;
    knownSheetNames: string[];
  }>;
};

type SlidePlanChart = {
  id?: string;
  excelSheetName?: string;
};

type SlidePlanEntry = {
  position: number;
  chart?: SlidePlanChart;
};

export function validatePlanSheetNames(input: {
  slidePlan: SlidePlanEntry[];
  datasetProfile: DatasetProfile;
}): PlanSheetNameReport {
  const knownSheetNames = collectKnownSheetNames(input.datasetProfile);
  const knownSheetSet = new Set(knownSheetNames.map(normalizeSheetName));
  const fabricatedSheetNames = input.slidePlan.flatMap((slide) => {
    const claimedSheetName = slide.chart?.excelSheetName?.trim();
    if (!claimedSheetName) {
      return [];
    }

    const normalizedClaim = normalizeSheetName(claimedSheetName);
    if (
      knownSheetSet.has(normalizedClaim) ||
      normalizedClaim.startsWith("computed_") ||
      knownSheetNames.some((known) => normalizedClaim.includes(normalizeSheetName(known)))
    ) {
      return [];
    }

    return [{
      slidePosition: slide.position,
      chartId: slide.chart?.id?.trim() || `chart-${slide.position}`,
      claimedSheetName,
      knownSheetNames,
    }];
  });

  return {
    valid: fabricatedSheetNames.length === 0,
    fabricatedSheetNames,
  };
}

export function renderSheetNameRejectionMessage(report: PlanSheetNameReport) {
  const lines = [
    "The slide plan references sheet names that do not exist in the uploaded dataset profile.",
    "You must use only uploaded sheet names or clearly derived computed_ sheet names.",
    "",
    "Invalid references:",
    ...report.fabricatedSheetNames.map((entry) =>
      `- slide ${entry.slidePosition}, ${entry.chartId}: "${entry.claimedSheetName}" is not one of ${entry.knownSheetNames.join(", ")}`,
    ),
    "",
    "Return corrected JSON only.",
  ];

  return lines.join("\n");
}

function collectKnownSheetNames(datasetProfile: DatasetProfile) {
  const names = new Set<string>();

  for (const sheet of datasetProfile.sheets) {
    if (sheet.name.trim()) {
      names.add(sheet.name.trim());
    }
    const splitName = sheet.name.includes("·")
      ? sheet.name.split("·").pop()?.trim()
      : null;
    if (splitName) {
      names.add(splitName);
    }
  }

  for (const sourceFile of datasetProfile.sourceFiles) {
    if (sourceFile.fileName.trim()) {
      names.add(sourceFile.fileName.trim());
    }
    const withoutExt = sourceFile.fileName.replace(/\.[^.]+$/, "").trim();
    if (withoutExt) {
      names.add(withoutExt);
    }
  }

  return [...names];
}

function normalizeSheetName(value: string) {
  return value.trim().toLowerCase();
}
