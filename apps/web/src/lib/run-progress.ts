const PHASE_BANDS = {
  normalize: { expectedSeconds: 20, startPercent: 2, endPercent: 8 },
  understand: { expectedSeconds: 330, startPercent: 8, endPercent: 28 },
  author: { expectedSeconds: 900, startPercent: 28, endPercent: 68 },
  render: { expectedSeconds: 20, startPercent: 68, endPercent: 72 },
  critique: { expectedSeconds: 45, startPercent: 72, endPercent: 80 },
  revise: { expectedSeconds: 480, startPercent: 80, endPercent: 92 },
  export: { expectedSeconds: 30, startPercent: 92, endPercent: 96 },
} as const;

export type ProgressPhase = keyof typeof PHASE_BANDS;

export function buildPhaseProgressModel(input: {
  phases: readonly string[];
  currentPhase: string | undefined;
  completedPhases: Set<string>;
  phaseStartedAt: string | null;
  nowMs: number;
}) {
  const currentPhase = asProgressPhase(input.currentPhase);
  const phaseStartedAtMs = input.phaseStartedAt ? new Date(input.phaseStartedAt).getTime() : null;
  const elapsedInPhaseSeconds = phaseStartedAtMs
    ? Math.max(1, Math.round((input.nowMs - phaseStartedAtMs) / 1000))
    : 0;

  if (!currentPhase) {
    return {
      elapsedInPhaseSeconds,
      progressPercent: 2,
    };
  }

  const band = PHASE_BANDS[currentPhase];
  const phaseFraction = estimatePhaseFraction(elapsedInPhaseSeconds, band.expectedSeconds);
  const rawProgress = band.startPercent + (band.endPercent - band.startPercent) * phaseFraction;

  const highestCompletedPercent = input.phases
    .map(asProgressPhase)
    .filter((phase): phase is ProgressPhase => Boolean(phase))
    .filter((phase) => input.completedPhases.has(phase))
    .reduce((max, phase) => Math.max(max, PHASE_BANDS[phase].endPercent), 2);

  return {
    elapsedInPhaseSeconds,
    progressPercent: Math.max(highestCompletedPercent, rawProgress),
  };
}

export function estimateRemainingSecondsForPhase(input: {
  phases: readonly string[];
  currentPhase: string | undefined;
  completedPhases: Set<string>;
  elapsedInPhaseSeconds: number;
}) {
  const currentPhase = asProgressPhase(input.currentPhase);
  const remainingAfterCurrent = input.phases
    .map(asProgressPhase)
    .filter((phase): phase is ProgressPhase => Boolean(phase))
    .filter((phase) => phase !== currentPhase && !input.completedPhases.has(phase))
    .reduce((sum, phase) => sum + PHASE_BANDS[phase].expectedSeconds, 0);

  if (!currentPhase) {
    return {
      midpointSeconds: remainingAfterCurrent,
      lowSeconds: Math.round(remainingAfterCurrent * 0.8),
      highSeconds: Math.round(remainingAfterCurrent * 1.35),
      confidence: "low" as const,
    };
  }

  const expectedSeconds = PHASE_BANDS[currentPhase].expectedSeconds;
  if (input.elapsedInPhaseSeconds <= expectedSeconds) {
    const currentRemaining = Math.max(30, expectedSeconds - input.elapsedInPhaseSeconds);
    const midpointSeconds = currentRemaining + remainingAfterCurrent;
    return {
      midpointSeconds,
      lowSeconds: Math.max(30, Math.round(midpointSeconds * 0.8)),
      highSeconds: Math.round(midpointSeconds * 1.4),
      confidence: input.elapsedInPhaseSeconds < expectedSeconds * 0.35 ? "medium" as const : "high" as const,
    };
  }

  const overtimeRatio = (input.elapsedInPhaseSeconds - expectedSeconds) / Math.max(expectedSeconds, 60);
  const currentRemaining = Math.max(90, Math.round(expectedSeconds * Math.min(0.8, 0.35 + overtimeRatio * 0.25)));
  const midpointSeconds = currentRemaining + remainingAfterCurrent;
  return {
    midpointSeconds,
    lowSeconds: Math.max(60, Math.round(midpointSeconds * 0.85)),
    highSeconds: Math.round(midpointSeconds * 1.65),
    confidence: "low" as const,
  };
}

function asProgressPhase(phase: string | undefined | null) {
  if (!phase) {
    return null;
  }

  return phase in PHASE_BANDS ? (phase as ProgressPhase) : null;
}

function estimatePhaseFraction(elapsedSeconds: number, expectedSeconds: number) {
  if (expectedSeconds <= 0) {
    return 0;
  }

  const ratio = elapsedSeconds / expectedSeconds;
  if (ratio <= 0.5) {
    return ratio * 0.7;
  }

  if (ratio <= 1) {
    return 0.35 + ((ratio - 0.5) / 0.5) * 0.4;
  }

  const overtime = (elapsedSeconds - expectedSeconds) / Math.max(expectedSeconds * 0.8, 60);
  return Math.min(0.92, 0.75 + 0.17 * (1 - Math.exp(-overtime)));
}
