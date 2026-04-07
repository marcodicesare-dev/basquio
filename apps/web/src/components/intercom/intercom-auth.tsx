"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";

const INTERCOM_APP_ID = process.env.NEXT_PUBLIC_INTERCOM_APP_ID;

/**
 * Authenticated Intercom for logged-in users.
 * Identifies the user so conversations persist across sessions.
 * Loads on first interaction to avoid PageSpeed impact.
 */
export function IntercomAuth({
  userId,
  email,
  name,
  createdAt,
}: {
  userId: string;
  email: string;
  name?: string;
  createdAt?: string;
}) {
  const pathname = usePathname();
  const initialized = useRef(false);
  const loadAttempted = useRef(false);

  const loadIntercom = useCallback(async () => {
    if (loadAttempted.current || !INTERCOM_APP_ID) return;
    loadAttempted.current = true;

    try {
      const { default: Intercom } = await import("@intercom/messenger-js-sdk");
      Intercom({
        app_id: INTERCOM_APP_ID,
        user_id: userId,
        email,
        ...(name ? { name } : {}),
        ...(createdAt ? { created_at: Math.floor(new Date(createdAt).getTime() / 1000) } : {}),
      } as Parameters<typeof Intercom>[0]);
      initialized.current = true;
    } catch (err) {
      console.error("[Intercom] Failed to load:", err);
    }
  }, [userId, email, name, createdAt]);

  useEffect(() => {
    if (!INTERCOM_APP_ID) return;

    const events = ["scroll", "mousemove", "touchstart", "click", "keydown"];
    const handleInteraction = () => {
      loadIntercom();
      events.forEach(e => window.removeEventListener(e, handleInteraction, { capture: true }));
    };
    events.forEach(e => window.addEventListener(e, handleInteraction, { capture: true, passive: true } as AddEventListenerOptions));

    return () => {
      events.forEach(e => window.removeEventListener(e, handleInteraction, { capture: true }));
    };
  }, [loadIntercom]);

  useEffect(() => {
    if (initialized.current && typeof window !== "undefined" && window.Intercom) {
      window.Intercom("update");
    }
  }, [pathname]);

  return null;
}
