"use client";

import { useState } from "react";
import Image from "next/image";

const slides = [
  {
    id: "executive",
    label: "Executive Overview",
    src: "/showcase/slide-showcase-executive.svg",
    alt: "Executive overview slide with KPI cards, segment breakdown, and key finding",
  },
  {
    id: "segment",
    label: "Segment Analysis",
    src: "/showcase/slide-showcase-chart.svg",
    alt: "Segment performance slide with horizontal bar chart and growth rates",
  },
  {
    id: "recommendations",
    label: "Recommendations",
    src: "/showcase/slide-showcase-recommendations.svg",
    alt: "Recommendations slide with prioritized next actions",
  },
] as const;

type SlideId = (typeof slides)[number]["id"];

export function SlideShowcase() {
  const [active, setActive] = useState<SlideId>(slides[0].id);

  return (
    <div className="slide-showcase">
      <div className="showcase-tabs" role="tablist" aria-label="Output slides">
        {slides.map((slide) => (
          <button
            key={slide.id}
            type="button"
            role="tab"
            aria-selected={active === slide.id}
            aria-controls={`panel-${slide.id}`}
            tabIndex={active === slide.id ? 0 : -1}
            className={`showcase-tab${active === slide.id ? " active" : ""}`}
            onClick={() => setActive(slide.id)}
          >
            {slide.label}
          </button>
        ))}
      </div>

      <div className="showcase-viewport">
        {slides.map((slide) => (
          <div
            key={slide.id}
            id={`panel-${slide.id}`}
            role="tabpanel"
            className={`showcase-panel${active === slide.id ? " active" : ""}`}
            aria-hidden={active !== slide.id}
          >
            <Image
              src={slide.src}
              alt={slide.alt}
              width={960}
              height={540}
              priority={slide.id === slides[0].id}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
