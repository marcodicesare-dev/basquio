"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const ROUTE_PENDING_TIMEOUT_MS = 6000;

export function WorkspaceInteractionLayer() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const [routePending, setRoutePending] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setRoutePending(false);
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [routeKey]);

  useEffect(() => {
    const clearTimer = () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        setRoutePending(false);
        timeoutRef.current = null;
      }, ROUTE_PENDING_TIMEOUT_MS);
    };

    const handleClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || !anchor.closest(".wbeta-shell")) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const nextUrl = new URL(anchor.href, window.location.href);
      if (nextUrl.origin !== window.location.origin) return;
      if (
        nextUrl.pathname === window.location.pathname &&
        nextUrl.search === window.location.search &&
        nextUrl.hash === window.location.hash
      ) {
        return;
      }

      setRoutePending(true);
      clearTimer();
    };

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div
      className={routePending ? "wbeta-route-progress wbeta-route-progress-on" : "wbeta-route-progress"}
      role="status"
      aria-live="polite"
      aria-label={routePending ? "Loading next workspace view" : undefined}
      aria-hidden={!routePending}
    >
      <span className="wbeta-route-progress-bar" aria-hidden />
    </div>
  );
}
