"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";

const INTERCOM_APP_ID = process.env.NEXT_PUBLIC_INTERCOM_APP_ID;

/**
 * Anonymous Intercom for marketing pages.
 * Loads on first user interaction (scroll/click/touch) to avoid PageSpeed impact.
 */
export function IntercomProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const initialized = useRef(false);
  const loadAttempted = useRef(false);

  const loadIntercom = useCallback(async () => {
    if (loadAttempted.current || !INTERCOM_APP_ID) return;
    loadAttempted.current = true;

    try {
      const { default: Intercom } = await import("@intercom/messenger-js-sdk");
      Intercom({ app_id: INTERCOM_APP_ID });
      initialized.current = true;
    } catch (err) {
      console.error("[Intercom] Failed to load:", err);
    }
  }, []);

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
    if (initialized.current && typeof window !== "undefined" && window.Intercom != null) {
      window.Intercom("update");
    }
  }, [pathname]);

  return <>{children}</>;
}

