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
  eyebrow = "Start with real evidence",
  title = "Bring one reporting cycle into Basquio.",
  copy = "Start with the files behind one review and see the first editable PPTX and polished PDF Basquio can produce.",
  primaryLabel = "Try with your data",
  primaryHref = "/jobs/new",
  secondaryLabel = "See how to get started",
  secondaryHref = "/get-started",
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
