const UNLIMITED_ACCESS_EMAILS = new Set<string>([
  // Co-founder bypass emails can be added here
]);

export function hasUnlimitedAccess(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalizedEmail = email.trim().toLowerCase();
  return normalizedEmail.endsWith("@basquio.com") || UNLIMITED_ACCESS_EMAILS.has(normalizedEmail);
}
