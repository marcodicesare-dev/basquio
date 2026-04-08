export const SIGNUP_ATTRIBUTION_STORAGE_KEY = "basquio_signup_source";
export const SIGNUP_ATTRIBUTION_COOKIE_NAME = "basquio_signup_source";

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
  document.cookie = `${SIGNUP_ATTRIBUTION_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(payload))}; Path=/; Max-Age=2592000; SameSite=Lax`;
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
    return normalizeSignupAttribution(JSON.parse(raw) as Partial<SignupAttribution>);
  } catch {
    return null;
  }
}

export function clearSignupAttributionFromBrowser() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(SIGNUP_ATTRIBUTION_STORAGE_KEY);
  document.cookie = `${SIGNUP_ATTRIBUTION_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function readSignupAttributionFromCookie(cookieHeader: string | null | undefined): SignupAttribution | null {
  if (!cookieHeader) {
    return null;
  }

  const cookieValue = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SIGNUP_ATTRIBUTION_COOKIE_NAME}=`))
    ?.slice(`${SIGNUP_ATTRIBUTION_COOKIE_NAME}=`.length);

  if (!cookieValue) {
    return null;
  }

  try {
    return normalizeSignupAttribution(JSON.parse(decodeURIComponent(cookieValue)) as Partial<SignupAttribution>);
  } catch {
    return null;
  }
}

export function normalizeSignupAttribution(value: Partial<SignupAttribution> | null | undefined): SignupAttribution | null {
  if (!value || typeof value.source !== "string" || value.source.trim().length === 0) {
    return null;
  }

  return {
    source: value.source.trim(),
    medium: typeof value.medium === "string" && value.medium.trim() ? value.medium.trim() : undefined,
    campaign: typeof value.campaign === "string" && value.campaign.trim() ? value.campaign.trim() : undefined,
    landingPath: typeof value.landingPath === "string" && value.landingPath.trim() ? value.landingPath.trim() : undefined,
    referrer: typeof value.referrer === "string" && value.referrer.trim() ? value.referrer.trim() : undefined,
  };
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
