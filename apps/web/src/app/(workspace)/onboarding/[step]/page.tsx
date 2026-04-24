import { notFound } from "next/navigation";

import { WorkspaceOnboarding } from "@/components/workspace-onboarding";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Set up workspace · Basquio",
};

type Params = {
  step: string;
};

function parseStep(step: string): 1 | 2 | 3 | null {
  if (step === "1") return 1;
  if (step === "2") return 2;
  if (step === "3") return 3;
  return null;
}

export default async function OnboardingStepPage({ params }: { params: Promise<Params> }) {
  const { step } = await params;
  const parsedStep = parseStep(step);
  if (!parsedStep) notFound();

  return (
    <div className="wbeta-page wbeta-page-onboard">
      <WorkspaceOnboarding initialStep={parsedStep} routed />
    </div>
  );
}
