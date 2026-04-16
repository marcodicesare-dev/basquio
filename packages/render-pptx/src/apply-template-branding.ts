/**
 * Post-Generation Template Injection (PGTI)
 *
 * After Claude generates a deck via PptxGenJS, this function opens the PPTX
 * (ZIP of XML) and deterministically injects the client's template branding:
 * - Theme color scheme + font scheme (fixes "Office Theme" default)
 * - Logo on the slide master (appears on every slide)
 * - Decorative shapes on the slide master (sidebars, footer bars)
 * - Master background color
 *
 * Cost: $0. Time: <100ms. Deterministic: yes.
 */
import JSZip from "jszip";

const EMU_PER_INCH = 914_400;
function inchesToEmu(inches: number): number {
  return Math.round(inches * EMU_PER_INCH);
}

export interface InjectionPayload {
  themeColorSchemeXml: string;
  themeFontSchemeXml: string;
  logoBase64: string | null;
  logoMimeType: "image/png" | "image/jpeg";
  logoPosition: { x: number; y: number; w: number; h: number } | null;
  decorativeShapes: Array<{
    x: number; y: number; w: number; h: number;
    fill: string; // hex without #
  }>;
  masterBackground: string | null; // hex without #
}

/** Next available shape ID — avoids collisions with PptxGenJS-generated IDs. */
let shapeIdCounter = 9000;
function nextShapeId(): number {
  return shapeIdCounter++;
}

/**
 * Apply template branding to a generated PPTX buffer.
 * Returns the branded PPTX buffer.
 */
export async function applyTemplateBranding(
  pptxBuffer: Buffer,
  injection: InjectionPayload,
): Promise<Buffer> {
  // Reset counter per invocation for determinism
  shapeIdCounter = 9000;

  const zip = await JSZip.loadAsync(pptxBuffer);
  const slideSize = await readSlideSize(zip);

  // 1. Replace theme color + font schemes
  if (injection.themeColorSchemeXml || injection.themeFontSchemeXml) {
    await replaceThemeSchemes(zip, injection);
  }

  // 2. Inject logo + decorative shapes + background into slide master
  await injectMasterElements(zip, injection, slideSize);

  // 3. Ensure content types cover image extensions
  await ensureContentTypes(zip, injection);

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  }) as Promise<Buffer>;
}

async function replaceThemeSchemes(
  zip: JSZip,
  injection: InjectionPayload,
): Promise<void> {
  const themeEntry = "ppt/theme/theme1.xml";
  const file = zip.file(themeEntry);
  if (!file) return;

  let xml = await file.async("text");

  if (injection.themeColorSchemeXml) {
    xml = xml.replace(
      /<a:clrScheme\b[^>]*>[\s\S]*?<\/a:clrScheme>/i,
      injection.themeColorSchemeXml,
    );
  }

  if (injection.themeFontSchemeXml) {
    xml = xml.replace(
      /<a:fontScheme\b[^>]*>[\s\S]*?<\/a:fontScheme>/i,
      injection.themeFontSchemeXml,
    );
  }

  zip.file(themeEntry, xml);
}

async function injectMasterElements(
  zip: JSZip,
  injection: InjectionPayload,
  slideSize: { widthInches: number; heightInches: number },
): Promise<void> {
  // Discover all slide masters in the PPTX — corporate templates may have 2+
  const masterEntries = Object.keys(zip.files)
    .filter((e) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/i.test(e))
    .sort();

  if (masterEntries.length === 0) return;

  // Add the logo image to ppt/media/ once (shared across all masters)
  const ext = injection.logoMimeType === "image/jpeg" ? "jpeg" : "png";
  const mediaPath = `ppt/media/client_logo.${ext}`;
  if (injection.logoBase64) {
    const base64Data = injection.logoBase64.replace(/^data:image\/[a-z]+;base64,/, "");
    zip.file(mediaPath, Buffer.from(base64Data, "base64"));
  }

  for (const masterEntry of masterEntries) {
    const masterFile = zip.file(masterEntry);
    if (!masterFile) continue;

    let masterXml = await masterFile.async("text");
    const elementsToInsert: string[] = [];

    // Master background
    if (injection.masterBackground) {
      masterXml = injectMasterBackground(masterXml, injection.masterBackground);
    }

    // Decorative shapes (inserted before logo for correct z-order)
    for (const shape of injection.decorativeShapes) {
      elementsToInsert.push(buildDecorativeShapeXml(shape));
    }

    // Logo — add a rels entry per master pointing to the shared media file
    const logoPosition = resolveVisibleLogoPosition(injection.logoPosition, slideSize);
    if (injection.logoBase64 && logoPosition) {
      const rId = await addLogoRelToMaster(zip, masterEntry, mediaPath);
      if (rId) {
        elementsToInsert.push(buildLogoPicXml(rId, logoPosition));
      }
    }

    if (elementsToInsert.length > 0) {
      masterXml = insertIntoSpTree(masterXml, elementsToInsert);
    }

    zip.file(masterEntry, masterXml);
  }
}

function injectMasterBackground(masterXml: string, bgColor: string): string {
  const bgXml = `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bgColor}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;

  // Replace existing background
  if (/<p:bg>/.test(masterXml)) {
    return masterXml.replace(/<p:bg>[\s\S]*?<\/p:bg>/i, bgXml);
  }

  // Insert before <p:spTree>
  return masterXml.replace(/<p:spTree>/, `${bgXml}<p:spTree>`);
}

function buildDecorativeShapeXml(shape: {
  x: number; y: number; w: number; h: number; fill: string;
}): string {
  const id = nextShapeId();
  return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="${id}" name="DecorativeBar${id}"/>
    <p:cNvSpPr/>
    <p:nvPr userDrawn="1"/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="${inchesToEmu(shape.x)}" y="${inchesToEmu(shape.y)}"/>
      <a:ext cx="${inchesToEmu(shape.w)}" cy="${inchesToEmu(shape.h)}"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:solidFill><a:srgbClr val="${shape.fill.replace(/^#/, "")}"/></a:solidFill>
    <a:ln><a:noFill/></a:ln>
  </p:spPr>
  <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>
</p:sp>`;
}

function buildLogoPicXml(
  rId: string,
  pos: { x: number; y: number; w: number; h: number },
): string {
  const id = nextShapeId();
  return `<p:pic>
  <p:nvPicPr>
    <p:cNvPr id="${id}" name="ClientLogo" descr="Client Logo"/>
    <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
    <p:nvPr userDrawn="1"/>
  </p:nvPicPr>
  <p:blipFill>
    <a:blip r:embed="${rId}"/>
    <a:stretch><a:fillRect/></a:stretch>
  </p:blipFill>
  <p:spPr>
    <a:xfrm>
      <a:off x="${inchesToEmu(pos.x)}" y="${inchesToEmu(pos.y)}"/>
      <a:ext cx="${inchesToEmu(pos.w)}" cy="${inchesToEmu(pos.h)}"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
  </p:spPr>
</p:pic>`;
}

/**
 * Add a relationship entry pointing to the shared logo image for a specific slide master.
 * Returns the rId to reference from the <p:pic> element.
 */
async function addLogoRelToMaster(
  zip: JSZip,
  masterEntry: string,
  mediaPath: string,
): Promise<string | null> {
  const relsEntry = masterEntry.replace("slideMasters/", "slideMasters/_rels/") + ".rels";
  const relsFile = zip.file(relsEntry);
  if (!relsFile) return null;

  let relsXml = await relsFile.async("text");

  // Find the highest existing rId
  const rIdMatches = [...relsXml.matchAll(/Id="rId(\d+)"/g)];
  const maxId = rIdMatches.reduce((max, m) => Math.max(max, Number.parseInt(m[1], 10)), 0);
  const newRId = `rId${maxId + 1}`;

  // Compute relative target from this master's rels to ppt/media/
  const fileName = mediaPath.split("/").pop()!;
  const newRel = `<Relationship Id="${newRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${fileName}"/>`;
  relsXml = relsXml.replace(/<\/Relationships>/, `${newRel}</Relationships>`);

  zip.file(relsEntry, relsXml);
  return newRId;
}

function insertIntoSpTree(masterXml: string, elements: string[]): string {
  // Insert before </p:spTree> so new elements render on top of existing master content
  const joined = elements.join("\n");
  return masterXml.replace(/<\/p:spTree>/, `${joined}</p:spTree>`);
}

async function readSlideSize(zip: JSZip) {
  const presentationFile = zip.file("ppt/presentation.xml");
  if (!presentationFile) {
    return { widthInches: 13.333, heightInches: 7.5 };
  }

  const presentationXml = await presentationFile.async("text");
  const match = presentationXml.match(/<p:sldSz cx="(\d+)" cy="(\d+)"\/>/);
  if (!match) {
    return { widthInches: 13.333, heightInches: 7.5 };
  }

  return {
    widthInches: Number(match[1]) / EMU_PER_INCH,
    heightInches: Number(match[2]) / EMU_PER_INCH,
  };
}

function resolveVisibleLogoPosition(
  original: InjectionPayload["logoPosition"],
  slideSize: { widthInches: number; heightInches: number },
) {
  if (!original) {
    return null;
  }

  const aspectRatio = original.w > 0 && original.h > 0
    ? clamp(original.w / original.h, 0.5, 4)
    : 1;
  const minVisibleWidth = clamp(slideSize.widthInches * 0.055, 0.6, 0.95);
  const minVisibleHeight = clamp(slideSize.heightInches * 0.055, 0.42, 0.72);
  const needsPromotion = original.w < minVisibleWidth || original.h < minVisibleHeight;

  if (!needsPromotion) {
    return clampLogoToSlide(original, slideSize);
  }

  let width = Math.max(original.w, minVisibleWidth);
  let height = width / aspectRatio;

  if (height < minVisibleHeight) {
    height = minVisibleHeight;
    width = height * aspectRatio;
  }

  const maxHeaderHeight = slideSize.heightInches * 0.12;
  if (height > maxHeaderHeight) {
    height = maxHeaderHeight;
    width = height * aspectRatio;
  }

  const marginX = clamp(slideSize.widthInches * 0.04, 0.3, 0.55);
  const marginY = clamp(slideSize.heightInches * 0.05, 0.28, 0.42);

  return clampLogoToSlide({
    x: slideSize.widthInches - marginX - width,
    y: marginY,
    w: width,
    h: height,
  }, slideSize);
}

function clampLogoToSlide(
  position: NonNullable<InjectionPayload["logoPosition"]>,
  slideSize: { widthInches: number; heightInches: number },
) {
  const width = clamp(position.w, 0.2, Math.max(0.2, slideSize.widthInches - 0.4));
  const height = clamp(position.h, 0.2, Math.max(0.2, slideSize.heightInches - 0.4));

  return {
    x: clamp(position.x, 0.1, Math.max(0.1, slideSize.widthInches - width - 0.1)),
    y: clamp(position.y, 0.1, Math.max(0.1, slideSize.heightInches - height - 0.1)),
    w: width,
    h: height,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

async function ensureContentTypes(
  zip: JSZip,
  injection: InjectionPayload,
): Promise<void> {
  if (!injection.logoBase64) return;

  const ctFile = zip.file("[Content_Types].xml");
  if (!ctFile) return;

  let ctXml = await ctFile.async("text");
  const ext = injection.logoMimeType === "image/jpeg" ? "jpeg" : "png";
  const contentType = injection.logoMimeType;

  // Check if default extension already exists
  const pattern = new RegExp(`Extension="${ext}"`, "i");
  if (!pattern.test(ctXml)) {
    ctXml = ctXml.replace(
      /<\/Types>/,
      `<Default Extension="${ext}" ContentType="${contentType}"/></Types>`,
    );
    zip.file("[Content_Types].xml", ctXml);
  }
}
