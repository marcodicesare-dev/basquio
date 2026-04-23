import assert from "node:assert/strict";

import JSZip from "jszip";

import { applyTemplateBranding } from "../packages/render-pptx/src/apply-template-branding";

async function buildMinimalPptx() {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:sldSz cx="12192000" cy="6858000"/>' +
      "</p:presentation>",
  );
  zip.file(
    "ppt/theme/theme1.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<a:themeElements><a:clrScheme name="Test"></a:clrScheme><a:fontScheme name="Test"></a:fontScheme></a:themeElements>' +
      "</a:theme>",
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      "<p:cSld><p:spTree></p:spTree></p:cSld>" +
      "</p:sldMaster>",
  );

  return zip.generateAsync({ type: "nodebuffer" });
}

async function readMasterXml(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("ppt/slideMasters/slideMaster1.xml")?.async("text");
}

async function main() {
  const pptx = await buildMinimalPptx();

  const rejected = await applyTemplateBranding(pptx, {
    themeColorSchemeXml: "",
    themeFontSchemeXml: "",
    logoBase64: null,
    logoMimeType: "image/png",
    logoPosition: null,
    decorativeShapes: [],
    paletteHints: ["1A6AFF", "FFFFFF", "0B0C0C"],
    masterBackground: "B2B2B2",
  });
  const rejectedXml = await readMasterXml(rejected);
  assert.ok(!rejectedXml?.includes('srgbClr val="B2B2B2"'), "expected neutral placeholder master background to be ignored");

  const accepted = await applyTemplateBranding(pptx, {
    themeColorSchemeXml: "",
    themeFontSchemeXml: "",
    logoBase64: null,
    logoMimeType: "image/png",
    logoPosition: null,
    decorativeShapes: [],
    paletteHints: ["1A6AFF", "FFFFFF", "0B0C0C"],
    masterBackground: "1A6AFF",
  });
  const acceptedXml = await readMasterXml(accepted);
  assert.ok(acceptedXml?.includes('srgbClr val="1A6AFF"'), "expected branded master background to be preserved");

  process.stdout.write("template branding regression passed\n");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
