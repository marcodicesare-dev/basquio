import type { CSSProperties } from "react";

export function WorkspaceSkeleton({
  density,
  width = "100%",
  height,
  rows = 1,
  cols = 3,
  cellHeight = 56,
  label = "Loading content",
}: {
  density: "line" | "card" | "grid";
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  rows?: number;
  cols?: number;
  cellHeight?: number;
  label?: string;
}) {
  if (density === "grid") {
    return (
      <div
        className="wbeta-skeleton-grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          width,
        }}
        role="status"
        aria-label={label}
      >
        {Array.from({ length: Math.min(rows * cols, 9) }).map((_, index) => (
          <span
            // Static skeleton cells are intentionally position-based.
            key={index}
            className="wbeta-skeleton wbeta-skeleton-cell"
            style={{ height: cellHeight }}
          />
        ))}
      </div>
    );
  }

  return (
    <span
      className={density === "card" ? "wbeta-skeleton wbeta-skeleton-card" : "wbeta-skeleton wbeta-skeleton-line"}
      style={{
        width,
        height: height ?? (density === "card" ? 96 : undefined),
      }}
      role="status"
      aria-label={label}
    />
  );
}
