const UNLIMITED_ACCESS_EMAILS = new Set([
  "frarobpro@yahoo.it",
]);

export function hasUnlimitedAccess(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalizedEmail = email.trim().toLowerCase();
  return normalizedEmail.endsWith("@basquio.com") || UNLIMITED_ACCESS_EMAILS.has(normalizedEmail);
}
