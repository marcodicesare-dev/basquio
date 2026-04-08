"use client";

export const SIGNUP_ATTRIBUTION_STORAGE_KEY = "basquio_signup_source";

export type SignupAttribution = {
  source: string;
  medium?: string;
  campaign?: string;
  landingPath?: string;
  referrer?: string;
};

export function captureSignupAttributionFromBrowser() {
  if (typeof window === "undefined") {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const referrer = document.referrer.trim();
  const source = params.get("utm_source") || params.get("ref") || getReferrerHost(referrer) || "direct";
  const medium = params.get("utm_medium") || "";
  const campaign = params.get("utm_campaign") || "";
  const landingPath = `${window.location.pathname}${window.location.search}`;

  const payload: SignupAttribution = {
    source,
    medium: medium || undefined,
    campaign: campaign || undefined,
    landingPath,
    referrer: referrer || undefined,
  };

  window.sessionStorage.setItem(SIGNUP_ATTRIBUTION_STORAGE_KEY, JSON.stringify(payload));
}

export function readSignupAttributionFromBrowser(): SignupAttribution | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(SIGNUP_ATTRIBUTION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SignupAttribution>;
    if (!parsed || typeof parsed.source !== "string" || parsed.source.trim().length === 0) {
      return null;
    }

    return {
      source: parsed.source.trim(),
      medium: typeof parsed.medium === "string" && parsed.medium.trim() ? parsed.medium.trim() : undefined,
      campaign: typeof parsed.campaign === "string" && parsed.campaign.trim() ? parsed.campaign.trim() : undefined,
      landingPath: typeof parsed.landingPath === "string" && parsed.landingPath.trim() ? parsed.landingPath.trim() : undefined,
      referrer: typeof parsed.referrer === "string" && parsed.referrer.trim() ? parsed.referrer.trim() : undefined,
    };
  } catch {
    return null;
  }
}

export function clearSignupAttributionFromBrowser() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(SIGNUP_ATTRIBUTION_STORAGE_KEY);
}

function getReferrerHost(referrer: string): string | null {
  if (!referrer) {
    return null;
  }

  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
}
