import type { FidelityViolation } from "@basquio/intelligence";

export type PublishGateClaimIssue = {
  position: number;
  severity: "major" | "critical";
  message: string;
};

export function collectBlockingEvidenceFailures(input: {
  fidelityViolations: FidelityViolation[];
  claimIssues?: PublishGateClaimIssue[];
}) {
  return [
    ...input.fidelityViolations
      .filter((violation) => violation.severity === "critical" || violation.severity === "major")
      .map((violation) => `fidelity:Slide ${violation.position} [${violation.rule}] ${violation.message}`),
    ...((input.claimIssues ?? []).map((issue) => `claim:Slide ${issue.position} ${issue.message}`)),
  ];
}
