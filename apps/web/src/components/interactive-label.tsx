/**
 * InteractiveLabel · hand-drawn callout.
 *
 * Pairs a wavy hand-drawn SVG arrow with a script-font "interactive" label,
 * positioned absolutely over a target. Pattern borrowed from Excalidraw's
 * landing page annotations and Stripe's "Try it" callouts: small enough not
 * to compete with the actual UI, distinctive enough to invite the click.
 *
 * The arrow path uses intentionally imperfect quadratic Beziers and a
 * stroke-dasharray of 0 (no dashes) but the variable stroke-width gives it
 * a marker-pen feel. The arrowhead is a small triangle attached at the tip.
 *
 * Two prop variants control direction. Default points down-right (toward
 * a target below and to the right of the label).
 */

type InteractiveLabelProps = {
  text?: string;
  variant?: "down-right" | "down-left" | "right" | "left";
  className?: string;
};

export function InteractiveLabel({
  text = "interactive",
  variant = "down-right",
  className,
}: InteractiveLabelProps) {
  const path = ARROW_PATHS[variant];
  return (
    <div
      className={`interactive-label interactive-label-${variant} ${className ?? ""}`}
      aria-hidden="true"
    >
      <span className="interactive-label-text">{text}</span>
      <svg
        className="interactive-label-arrow"
        width="92"
        height="68"
        viewBox="0 0 92 68"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d={path.d}
          stroke="#0B0C0C"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={path.head}
          stroke="#0B0C0C"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

const ARROW_PATHS = {
  // Curve starts top-left, sweeps down-right with a wobble, head pointing
  // toward bottom-right.
  "down-right": {
    d: "M 6 8 Q 12 22 24 28 Q 38 36 52 38 Q 66 41 78 52 Q 82 56 84 60",
    head: "M 76 56 L 84 60 L 80 51",
  },
  "down-left": {
    d: "M 86 8 Q 80 22 68 28 Q 54 36 40 38 Q 26 41 14 52 Q 10 56 8 60",
    head: "M 16 56 L 8 60 L 12 51",
  },
  right: {
    d: "M 6 34 Q 22 30 38 32 Q 56 36 76 38 Q 80 38 84 38",
    head: "M 78 32 L 84 38 L 78 44",
  },
  left: {
    d: "M 86 34 Q 70 30 54 32 Q 36 36 16 38 Q 12 38 8 38",
    head: "M 14 32 L 8 38 L 14 44",
  },
};
