import Link from "next/link";

type PublicSiteFooterCtaProps = {
  eyebrow?: string;
  title?: string;
  copy?: string;
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
};

export function PublicSiteFooterCta({
  eyebrow = "Ready to try it?",
  title = "6 free credits on signup.",
  copy = "Enough for a 3-slide executive brief from your own data. No credit card required.",
  primaryLabel = "Try free →",
  primaryHref = "/jobs/new",
  secondaryLabel = "See how it works",
  secondaryHref = "/how-it-works",
}: PublicSiteFooterCtaProps) {
  return (
    <section className="dark-panel cta-footer">
      <div className="stack">
        <p className="section-label light">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="muted">{copy}</p>
      </div>

      <div className="row">
        <Link className="button" href={primaryHref}>
          {primaryLabel}
        </Link>
        <Link className="button secondary inverted" href={secondaryHref}>
          {secondaryLabel}
        </Link>
      </div>
    </section>
  );
}
