import { BuyCreditsButton } from "@/components/buy-credits-button";
import { CREDIT_PACK_CATALOG, getCreditPackConfig, normalizePlanId, planToCreditPackTier } from "@/lib/billing-config";

type CreditPackShelfProps = {
  title?: string;
  subtitle?: string;
  tone?: "marketing" | "app";
  plan?: string | null;
};

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function CreditPackShelf({
  title = "Credit packs",
  subtitle = "Top up anytime. Purchased credits attach to the signed-in account automatically and expire after 12 months.",
  tone = "marketing",
  plan = "free",
}: CreditPackShelfProps) {
  const normalizedPlan = normalizePlanId(plan);
  const pricingTier = planToCreditPackTier(normalizedPlan);
  const packs = Object.entries(CREDIT_PACK_CATALOG).map(([id, base]) => {
    const config = getCreditPackConfig(pricingTier, id as keyof typeof CREDIT_PACK_CATALOG);
    return {
      id,
      credits: base.credits,
      price: formatUsd(config.price),
      perCredit: `${formatUsd(config.perCredit)}/credit`,
      callout:
        pricingTier === "free"
          ? "Subscribers unlock lower per-credit rates."
          : pricingTier === "starter"
            ? "Starter pack pricing."
            : "Best per-credit rate.",
      featured: id === (pricingTier === "pro" ? "pack_100" : "pack_50"),
    };
  });

  const tierSummary = normalizedPlan === "free"
    ? "Showing Free-tier pack pricing."
    : normalizedPlan === "starter"
      ? "Showing Starter subscriber pack pricing."
      : normalizedPlan === "pro"
        ? "Showing Pro subscriber pack pricing."
        : "Showing subscriber pack pricing.";

  return (
    <section className={tone === "app" ? "credit-pack-shelf credit-pack-shelf-app" : "credit-pack-shelf"}>
      <div className="credit-pack-shelf-head">
        <div className="stack-xs">
          <p className="section-label">Credit packs</p>
          <h2>{title}</h2>
        </div>
        <div className="credit-pack-shelf-copy stack-xs">
          <p className="muted">{subtitle}</p>
          <p className="muted">{tierSummary}</p>
        </div>
      </div>

      <div className="credit-pack-grid">
        {packs.map((pack) => (
          <article
            key={pack.id}
            className={pack.featured ? "panel credit-pack-card credit-pack-card-featured" : "panel credit-pack-card"}
          >
            <div className="credit-pack-card-top">
              <div className="credit-pack-kicker-row">
                <p className="pricing-tier-name">{pack.credits} credits</p>
                {pack.featured ? <span className="pricing-badge">Best value</span> : null}
              </div>
              <div className="credit-pack-price-row">
                <p className="credit-pack-price">{pack.price}</p>
                <p className="credit-pack-rate">{pack.perCredit}</p>
              </div>
            </div>

            <p className="credit-pack-callout">{pack.callout}</p>

            <BuyCreditsButton
              packId={pack.id}
              label={tone === "app" ? `Buy ${pack.credits} credits` : `Buy ${pack.credits}`}
              highlighted={pack.featured}
            />
          </article>
        ))}
      </div>
    </section>
  );
}
