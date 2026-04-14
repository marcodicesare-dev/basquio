import {
  clearSignupAttributionFromBrowser,
  readSignupAttributionFromBrowser,
} from "@/lib/signup-attribution";

export async function bootstrapAccountRequest() {
  const signupAttribution = readSignupAttributionFromBrowser();
  const response = await fetch("/api/auth/bootstrap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(signupAttribution ? { signupAttribution } : {}),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "We couldn't finish setting up your workspace.");
  }

  clearSignupAttributionFromBrowser();
}
