import { BuyCreditsButton } from "@/components/buy-credits-button";

const CREDIT_PACKS = [
  {
    id: "pack_25",
    credits: 25,
    price: "$18",
    perCredit: "$0.72",
    callout: "Good for a couple of Deck refreshes.",
    featured: false,
  },
  {
    id: "pack_50",
    credits: 50,
    price: "$32",
    perCredit: "$0.64",
    callout: "Best fit for regular monthly top-ups.",
    featured: true,
  },
  {
    id: "pack_100",
    credits: 100,
    price: "$56",
    perCredit: "$0.56",
    callout: "For teams running recurring report cycles.",
    featured: false,
  },
  {
    id: "pack_250",
    credits: 250,
    price: "$125",
    perCredit: "$0.50",
    callout: "Lowest cost per credit for heavier usage.",
    featured: false,
  },
] as const;

type CreditPackShelfProps = {
  title?: string;
  subtitle?: string;
  tone?: "marketing" | "app";
};

export function CreditPackShelf({
  title = "Credit packs",
  subtitle = "Top up anytime. Purchased credits attach to the signed-in account automatically and expire after 12 months.",
  tone = "marketing",
}: CreditPackShelfProps) {
  return (
    <section className={tone === "app" ? "credit-pack-shelf credit-pack-shelf-app" : "credit-pack-shelf"}>
      <div className="credit-pack-shelf-head">
        <div className="stack-xs">
          <p className="section-label">Credit packs</p>
          <h2>{title}</h2>
        </div>
        <p className="muted credit-pack-shelf-copy">{subtitle}</p>
      </div>

      <div className="credit-pack-grid">
        {CREDIT_PACKS.map((pack) => (
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
                <p className="credit-pack-rate">{pack.perCredit}/credit</p>
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
