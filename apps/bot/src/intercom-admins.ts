import { TEAM_MEMBERS } from "./config.js";

const INTERCOM_API_VERSION = "2.13";
const BASQUIO_EMAIL_DOMAIN = "@basquio.com";

interface IntercomAdmin {
  id?: string | number;
  type?: string;
  name?: string;
  email?: string;
}

interface IntercomAdminsResponse {
  admins?: IntercomAdmin[];
}

const adminMap = new Map<string, string>();
let fallbackAdminId: string | null = null;

export async function loadIntercomAdmins(accessToken: string, apiBaseUrl: string): Promise<void> {
  adminMap.clear();
  fallbackAdminId = null;

  const response = await fetch(`${apiBaseUrl}/admins`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Intercom-Version": INTERCOM_API_VERSION,
    },
  });

  if (!response.ok) {
    console.warn(`[intercom-admins] Failed to load admins: ${response.status}`);
    return;
  }

  const payload = (await response.json()) as IntercomAdminsResponse;

  for (const admin of payload.admins ?? []) {
    const email = admin.email?.trim().toLowerCase();
    const adminId = admin.id != null ? String(admin.id) : null;

    if (!adminId || admin.type !== "admin" || !email || !email.endsWith(BASQUIO_EMAIL_DOMAIN)) {
      continue;
    }

    const prefix = email.split("@")[0]?.trim();
    if (!prefix) {
      continue;
    }

    adminMap.set(prefix, adminId);
    fallbackAdminId ??= adminId;
    console.log(`📇 Intercom admin mapped: ${prefix} → ${adminId}${admin.name ? ` (${admin.name})` : ""}`);
  }

  if (!fallbackAdminId) {
    console.warn("[intercom-admins] No @basquio.com Intercom admins found");
  }
}

export function resolveIntercomAdminId(discordDisplayName: string): string | null {
  const normalizedName = discordDisplayName.trim().toLowerCase();
  if (!normalizedName) {
    return fallbackAdminId;
  }

  for (const [prefix, adminId] of adminMap.entries()) {
    if (normalizedName === prefix || normalizedName.includes(prefix)) {
      return adminId;
    }
  }

  for (const member of Object.values(TEAM_MEMBERS)) {
    if (!member.aliases.some((alias) => normalizedName === alias || normalizedName.includes(alias))) {
      continue;
    }

    for (const alias of member.aliases) {
      const adminId = adminMap.get(alias);
      if (adminId) {
        return adminId;
      }
    }
  }

  return fallbackAdminId;
}
