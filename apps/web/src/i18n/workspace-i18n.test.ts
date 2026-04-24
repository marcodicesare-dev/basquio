import { describe, expect, it } from "vitest";

import {
  formatWorkspaceDate,
  formatWorkspaceNumber,
  getWorkspaceCopy,
  resolveWorkspaceLocale,
} from "@/i18n";

describe("workspace i18n", () => {
  it("detects Italian browser locales and returns Italian chrome copy", () => {
    const locale = resolveWorkspaceLocale("it-IT,it;q=0.9,en;q=0.8");
    const copy = getWorkspaceCopy(locale);

    expect(locale).toBe("it");
    expect(copy.sidebar.newClient).toBe("Nuovo cliente");
    expect(copy.chat.send).toBe("Invia");
  });

  it("formats Italian numbers and dates with Designers Italia conventions", () => {
    expect(formatWorkspaceDate("2026-04-24T12:00:00.000Z", "it")).toBe("24/04/2026");
    expect(formatWorkspaceNumber(1234567.89, "it")).toBe("1.234.567,89");
  });
});
