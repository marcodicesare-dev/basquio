import { Buffer } from "node:buffer";

import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { parseDocument } from "./parsing";

describe("workspace document parsing", () => {
  it("parses PDFs with the installed pdf-parse runtime", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([320, 180]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Giulia upload is readable", {
      x: 24,
      y: 120,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    const parsed = await parseDocument(Buffer.from(await pdf.save()), "pdf", "application/pdf");

    expect(parsed.text).toContain("Giulia upload is readable");
    expect(parsed.pageCount).toBe(1);
  });

  it("extracts PPTX slide text, tables, and chart values", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      [
        "<p:sld>",
        "<a:t>FY 2025 tablet shift</a:t>",
        "<a:tbl>",
        "<a:tr><a:tc><a:t>Brand</a:t></a:tc><a:tc><a:t>Share</a:t></a:tc></a:tr>",
        "<a:tr><a:tc><a:t>Milka</a:t></a:tc><a:tc><a:t>42</a:t></a:tc></a:tr>",
        "</a:tbl>",
        "</p:sld>",
      ].join(""),
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      '<Relationships><Relationship Target="../charts/chart1.xml"/></Relationships>',
    );
    zip.file(
      "ppt/charts/chart1.xml",
      [
        "<c:chart><c:title><a:t>Tablet mix</a:t></c:title>",
        "<c:ser><c:tx><c:v>Value</c:v></c:tx>",
        "<c:cat><c:v>2024</c:v><c:v>2025</c:v></c:cat>",
        "<c:val><c:v>10</c:v><c:v>18</c:v></c:val>",
        "</c:ser></c:chart>",
      ].join(""),
    );

    const parsed = await parseDocument(await zip.generateAsync({ type: "nodebuffer" }), "pptx");

    expect(parsed.text).toContain("[Slide 1]");
    expect(parsed.text).toContain("FY 2025 tablet shift");
    expect(parsed.text).toContain("Brand | Share");
    expect(parsed.text).toContain("Milka | 42");
    expect(parsed.text).toContain("Tablet mix");
    expect(parsed.text).toContain("2025: 18");
    expect(parsed.pageCount).toBe(1);
  });
});
