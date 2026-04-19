"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function WorkspaceAutoRefresh({
  processingCount,
  intervalMs = 4000,
}: {
  processingCount: number;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (processingCount <= 0) return;
    const id = window.setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [processingCount, intervalMs, router]);

  return null;
}
