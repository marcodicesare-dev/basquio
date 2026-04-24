import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { parseDeckManifest } from "./deck-manifest";
import { evaluateNativeTableCoverage } from "./pptx-table-qa";

describe("evaluateNativeTableCoverage", () => {
  it("flags slides that promise a native table but contain no PowerPoint table markup", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", `
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld><p:spTree><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></p:spTree></p:cSld>
      </p:sld>
    `);
    zip.file("ppt/slides/slide2.xml", `
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>fake grid</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
      </p:sld>
    `);

    const manifest = parseDeckManifest({
      slideCount: 2,
      slides: [
        { position: 1, title: "Table 1", slideArchetype: "table", hasDataTable: true },
        { position: 2, title: "Table 2", slideArchetype: "table", hasDataTable: true },
      ],
      charts: [],
    });

    const coverage = await evaluateNativeTableCoverage(zip, manifest);

    expect(coverage.slidesExpectingNativeTables).toEqual([1, 2]);
    expect(coverage.slidesMissingNativeTables).toEqual([2]);
    expect(coverage.slidesWithNativeTables).toEqual([1]);
  });

  it("passes when all required table slides contain native table markup", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide3.xml", `
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld><p:spTree><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></p:spTree></p:cSld>
      </p:sld>
    `);

    const manifest = parseDeckManifest({
      slideCount: 3,
      slides: [
        { position: 1, title: "Cover", slideArchetype: "cover" },
        { position: 3, title: "Channel table", slideArchetype: "table", hasDataTable: true },
      ],
      charts: [],
    });

    const coverage = await evaluateNativeTableCoverage(zip, manifest);

    expect(coverage.slidesMissingNativeTables).toEqual([]);
    expect(coverage.slidesWithNativeTables).toEqual([3]);
  });
});
