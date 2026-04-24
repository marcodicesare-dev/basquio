import { workspaceEn } from "@/i18n/en";
import { workspaceIt } from "@/i18n/it";

export type WorkspaceLocale = "en" | "it";
export type WorkspaceCopy = typeof workspaceEn | typeof workspaceIt;

export function resolveWorkspaceLocale(acceptLanguage: string | null | undefined): WorkspaceLocale {
  if (!acceptLanguage) return "en";
  const first = acceptLanguage.split(",")[0]?.trim().toLowerCase() ?? "";
  return first === "it" || first.startsWith("it-") ? "it" : "en";
}

export function getWorkspaceCopy(locale: WorkspaceLocale): WorkspaceCopy {
  return locale === "it" ? workspaceIt : workspaceEn;
}

export function formatWorkspaceDate(date: Date | string, locale: WorkspaceLocale): string {
  const value = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

export function formatWorkspaceNumber(value: number, locale: WorkspaceLocale): string {
  return new Intl.NumberFormat(locale === "it" ? "it-IT" : "en-US").format(value);
}
