"use client";

import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

type ScrollProgressState = {
  activeStep: number;
  progress: number;
};

export function useScrollProgress(stepCount: number): {
  trackRef: RefObject<HTMLDivElement | null>;
  activeStep: number;
  progress: number;
} {
  const trackRef = useRef<HTMLDivElement>(null);
  const [{ activeStep, progress }, setState] = useState<ScrollProgressState>({
    activeStep: 0,
    progress: 0,
  });

  useEffect(() => {
    const track = trackRef.current;

    if (!track) {
      return;
    }

    const sentinels = Array.from(track.querySelectorAll<HTMLElement>("[data-workflow-sentinel]"));

    if (sentinels.length === 0) {
      return;
    }

    const visibleDistances = new Map<number, number>();
    const thresholds = Array.from({ length: 21 }, (_, index) => index / 20);

    const updateStep = () => {
      if (visibleDistances.size === 0) {
        return;
      }

      let nextStep = 0;
      let minDistance = Number.POSITIVE_INFINITY;

      for (const [step, distance] of visibleDistances) {
        if (distance < minDistance) {
          minDistance = distance;
          nextStep = step;
        }
      }

      setState({
        activeStep: nextStep,
        progress: stepCount <= 1 ? 0 : nextStep / (stepCount - 1),
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const step = Number((entry.target as HTMLElement).dataset.stepIndex);

          if (Number.isNaN(step)) {
            continue;
          }

          if (!entry.isIntersecting) {
            visibleDistances.delete(step);
            continue;
          }

          const center = entry.boundingClientRect.top + entry.boundingClientRect.height / 2;
          const viewportCenter = window.innerHeight / 2;
          visibleDistances.set(step, Math.abs(center - viewportCenter));
        }

        updateStep();
      },
      {
        threshold: thresholds,
        rootMargin: "-40% 0px -40% 0px",
      },
    );

    for (const sentinel of sentinels) {
      observer.observe(sentinel);
    }

    return () => {
      observer.disconnect();
    };
  }, [stepCount]);

  return { trackRef, activeStep, progress };
}
