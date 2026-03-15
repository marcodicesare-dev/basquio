export function sanitizeNextPath(nextPath?: string | null, fallback = "/dashboard") {
  if (!nextPath || !nextPath.startsWith("/")) {
    return fallback;
  }

  if (nextPath.startsWith("//")) {
    return fallback;
  }

  return nextPath;
}

export function buildSignInPath(nextPath?: string | null) {
  const safeNextPath = sanitizeNextPath(nextPath);
  const searchParams = new URLSearchParams();

  if (safeNextPath) {
    searchParams.set("next", safeNextPath);
  }

  return `/sign-in?${searchParams.toString()}`;
}

export function buildResetPasswordPath(nextPath?: string | null, message?: string) {
  const safeNextPath = sanitizeNextPath(nextPath);
  const searchParams = new URLSearchParams();

  if (safeNextPath) {
    searchParams.set("next", safeNextPath);
  }

  if (message) {
    searchParams.set("message", message);
  }

  return `/auth/reset-password?${searchParams.toString()}`;
}
