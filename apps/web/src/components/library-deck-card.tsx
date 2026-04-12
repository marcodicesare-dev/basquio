"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

type LibraryDeckCardProps = {
  title: string;
  tier: string;
  slideCount: number;
  description: string;
  heroImage: string;
  slides: string[];
  downloadHref: string;
};

export function LibraryDeckCard({
  title,
  tier,
  slideCount,
  description,
  heroImage,
  slides,
  downloadHref,
}: LibraryDeckCardProps) {
  const [activeSlide, setActiveSlide] = useState(heroImage);

  return (
    <article className="library-card">
      <div className="library-card-hero">
        <Image
          src={activeSlide}
          alt={`${title} — slide preview`}
          width={960}
          height={540}
          quality={90}
        />
      </div>

      <div className="library-thumbnails">
        {slides.map((slide, index) => (
          <button
            key={slide}
            className={`library-thumbnail${activeSlide === slide ? " active" : ""}`}
            onClick={() => setActiveSlide(slide)}
            type="button"
            aria-label={`View slide ${index + 1}`}
          >
            <Image src={slide} alt="" width={120} height={68} quality={60} />
          </button>
        ))}
      </div>

      <div className="library-card-meta">
        <span className="library-tier-badge">
          {tier} &middot; {slideCount} slides
        </span>
        <h3>{title}</h3>
        <p className="muted">{description}</p>
      </div>

      <div className="library-card-actions">
        <a className="button" href={downloadHref} download>
          Download PPTX free
        </a>
        <Link className="button secondary" href="/jobs/new">
          Generate a deck like this →
        </Link>
      </div>
    </article>
  );
}
