import { ImageResponse } from "next/og";

export const alt = "The PowerPoint Tax calculator by Basquio";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "48px 56px",
          background:
            "radial-gradient(circle at top right, rgba(240, 204, 39, 0.2), transparent 280px), radial-gradient(circle at 12% 20%, rgba(26, 106, 255, 0.18), transparent 300px), linear-gradient(180deg, rgba(21, 24, 26, 0.98), rgba(11, 12, 12, 1))",
          color: "#f4f6f8",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 18,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "#f0cc27",
            }}
          >
            <span style={{ width: 22, height: 2, background: "#f0cc27" }} />
            The PowerPoint Tax
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 860 }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0 18px",
                fontSize: 68,
                fontWeight: 800,
                lineHeight: 0.95,
                letterSpacing: "-0.05em",
              }}
            >
              <span>You lost</span>
              <span style={{ color: "#1a6aff" }}>about 14 work weeks</span>
              <span>to manual decks last year.</span>
            </div>
            <div style={{ fontSize: 28, lineHeight: 1.35, color: "rgba(244, 246, 248, 0.84)" }}>
              Calculate the hours, dollars, and weeks your team gives away to spreadsheet-to-slide production.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 24 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 16, textTransform: "uppercase", letterSpacing: "0.16em", color: "rgba(244, 246, 248, 0.68)" }}>Hours lost</span>
              <strong style={{ fontSize: 56, lineHeight: 1, letterSpacing: "-0.05em", color: "#1a6aff" }}>580</strong>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 16, textTransform: "uppercase", letterSpacing: "0.16em", color: "rgba(244, 246, 248, 0.68)" }}>Cost lost</span>
              <strong style={{ fontSize: 56, lineHeight: 1, letterSpacing: "-0.05em", color: "#f0cc27" }}>$43,500</strong>
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.03em" }}>basquio.com/powerpoint-tax</div>
        </div>
      </div>
    ),
    size,
  );
}
