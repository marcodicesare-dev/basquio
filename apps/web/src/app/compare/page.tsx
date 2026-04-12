import { Check, Minus, X } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Image from "next/image";

import { detailedComparisonRows } from "@/app/site-content";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio vs Gamma vs Beautiful.ai vs ChatGPT",
  description:
    "Compare Basquio with AI slide generators (Gamma, Beautiful.ai), BI tools (Tableau, Power BI), and general AI (ChatGPT) for turning data files into finished analysis decks.",
  alternates: { canonical: "https://basquio.com/compare" },
};

function capabilityIcon(value: string) {
  if (value === "Yes") return <span className="cap-yes"><Check size={16} weight="bold" /></span>;
  if (value === "Partial") return <span className="cap-partial"><Minus size={16} weight="bold" /></span>;
  if (value === "No") return <span className="cap-no"><X size={16} weight="bold" /></span>;
  return <>—</>;
}

export default function ComparePage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="stack">
          <p className="section-label">Compare</p>
          <h1>What matters when the deck has to survive review.</h1>
          <p className="page-copy">
            Generic AI can draft language. Slide generators can help with layout. Neither reads your files, checks the
            math, or hands you a branded deck. Basquio does.
          </p>
        </div>
      </section>

      <section style={{ borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid var(--border)", background: "var(--canvas-2)" }}>
        <Image
          src="/illustrations/page-compare.png"
          alt="Atmospheric illustration of two plateaus separated by a deep canyon — analytics dashboards on one side, presentation designs on the other, with no bridge between them"
          width={1536}
          height={1024}
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 1200px"
          placeholder="blur"
          blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAACqADAAQAAAABAAAABwAAAAD/wAARCAAHAAoDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwAWFhYWFhYmFhYmNiYmJjZJNjY2NklcSUlJSUlcb1xcXFxcXG9vb29vb29vhoaGhoaGnJycnJyvr6+vr6+vr6+v/9sAQwEbHR0tKS1MKSlMt3xmfLe3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3/90ABAAB/9oADAMBAAIRAxEAPwDLnvPPTDoMiqu9f7gphoqkraIl66n/2Q=="
          style={{ width: "100%", height: "auto", display: "block" }}
        />
      </section>

      <section className="panel comparison-panel">
        <div className="comparison-legend">
          <span><Check size={14} weight="bold" /> Full support</span>
          <span><Minus size={14} weight="bold" /> Partial — works sometimes or with manual effort</span>
          <span><X size={14} weight="bold" /> Not available</span>
        </div>

        <div className="comparison-table-wrap">
          <table className="comparison-table">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">ChatGPT / Claude</th>
                <th scope="col">Gamma / Tome / Beautiful.ai</th>
                <th scope="col" className="comparison-positive">Basquio</th>
              </tr>
            </thead>
            <tbody>
              {detailedComparisonRows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{capabilityIcon(row.genericAi)}</td>
                  <td>{capabilityIcon(row.slideGenerators)}</td>
                  <td className="comparison-positive">{capabilityIcon(row.basquio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel dark-panel">
        <div className="stack">
          <p className="section-label">What this means</p>
          <div className="cards">
            <article className="panel stack">
              <h3>Your category review is tomorrow.</h3>
              <p className="muted">
                ChatGPT can write bullets. Gamma can make slides. Only Basquio can read your source files, check the
                math, and hand you a branded deck with real charts from your data.
              </p>
            </article>
            <article className="panel stack">
              <h3>Leadership wants one story from three trackers.</h3>
              <p className="muted">
                Other tools make you copy-paste numbers into a prompt and hope nothing drifts. Basquio loads the files
                directly, computes the shifts, and builds the narrative around what actually changed.
              </p>
            </article>
          </div>
        </div>
      </section>

      <PublicSiteFooterCta
        eyebrow="Want to see the workflow"
        title="See what happens between the upload and the finished deck."
        copy="The workflow page shows how Basquio moves from your uploaded files to a review-ready deck."
        secondaryLabel="Read how it works"
        secondaryHref="/how-it-works"
      />
      <PublicSiteFooter />
    </div>
  );
}
