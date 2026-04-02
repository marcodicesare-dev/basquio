import { createHash } from "node:crypto";
import path from "node:path";

import JSZip from "jszip";

import { inferSourceFileKind } from "@basquio/core";

import { templateProfileSchema, type TemplateProfile } from "@basquio/types";

type TemplateInput = {
  id: string;
  fileName?: string;
  reviewFeedback?: string[];
  sourceFile?: {
    fileName: string;
    mediaType?: string;
    base64: string;
  };
};

type SourceSlideReference = {
  sourceSlideNumber: number;
  sourceSlideName: string;
  regions: TemplateProfile["layouts"][number]["regions"];
};

type ExtractedBrandTokens = {
  palette?: Partial<NonNullable<TemplateProfile["brandTokens"]>["palette"]>;
  typography?: Partial<NonNullable<TemplateProfile["brandTokens"]>["typography"]>;
  spacing?: Partial<NonNullable<TemplateProfile["brandTokens"]>["spacing"]>;
  logo?: Partial<NonNullable<TemplateProfile["brandTokens"]>["logo"]>;
  decorativeShapes?: NonNullable<TemplateProfile["brandTokens"]>["decorativeShapes"];
  chartPalette?: string[];
};

export function createSystemTemplateProfile(): TemplateProfile {
  return templateProfileSchema.parse({
    id: "system-default",
    sourceType: "system",
    templateName: "Basquio Standard",
    themeName: "Warm Editorial",
    sourceFingerprint: "system-default",
    slideSize: "LAYOUT_WIDE",
    slideWidthInches: 13.333,
    slideHeightInches: 7.5,
    fonts: ["Arial"],
    colors: ["#0B0C0C", "#F0CC27", "#1A6AFF", "#4CC9A0", "#F5F1E8", "#D6D1C4"],
    spacingTokens: ["pageX:0.6", "pageY:0.5", "sectionGap:0.32", "blockGap:0.2"],
    logoAssetHints: [
      "/brand/svg/logo/basquio-logo-light-bg-mono.svg",
      "/brand/svg/icon/basquio-icon-onyx.svg",
    ],
    placeholderCatalog: ["eyebrow", "title", "subtitle", "body", "callout", "chart", "evidence-list"],
    brandTokens: {
      palette: {
        text: "#0B0C0C",
        muted: "#5D656B",
        background: "#F5F1E8",
        surface: "#FFFFFF",
        accent: "#1A6AFF",
        accentMuted: "#E0EBFF",
        accentLight: "#E0EBFF",
        highlight: "#F0CC27",
        border: "#D6D1C4",
        positive: "#4CC9A0",
        negative: "#E8636F",
        coverBg: "#F5F1E8",
        calloutGreen: "#4CC9A0",
        calloutOrange: "#F0CC27",
      },
      typography: {
        headingFont: "Arial",
        bodyFont: "Arial",
        monoFont: "Arial",
        titleSize: 24,
        bodySize: 12,
      },
      spacing: {
        pageX: 0.6,
        pageY: 0.5,
        sectionGap: 0.32,
        blockGap: 0.2,
        cardRadius: 0.06,
      },
      logo: {
        wordmarkPath: "/brand/svg/logo/basquio-logo-light-bg-mono.svg",
        iconPath: "/brand/svg/icon/basquio-icon-onyx.svg",
        treatment: "default",
      },
    },
    layouts: [
      {
        id: "cover",
        name: "Cover",
        sourceName: "System Cover",
        sourceMaster: "Basquio",
        placeholders: ["eyebrow", "title", "subtitle", "body"],
        regions: [
          { key: "eyebrow:0", placeholder: "eyebrow", placeholderIndex: 0, name: "Eyebrow", x: 0.7, y: 0.56, w: 11.9, h: 0.22, source: "system" },
          { key: "title:0", placeholder: "title", placeholderIndex: 0, name: "Title", x: 0.7, y: 0.98, w: 11.9, h: 0.92, source: "system" },
          { key: "subtitle:0", placeholder: "subtitle", placeholderIndex: 0, name: "Subtitle", x: 0.7, y: 1.94, w: 11.9, h: 0.56, source: "system" },
          { key: "body:0", placeholder: "body", placeholderIndex: 0, name: "Body", x: 0.7, y: 2.72, w: 11.9, h: 3.92, source: "system" },
        ],
        notes: [],
      },
      {
        id: "summary",
        name: "Summary",
        sourceName: "System Summary",
        sourceMaster: "Basquio",
        placeholders: ["title", "subtitle", "body", "callout"],
        regions: [
          { key: "title:0", placeholder: "title", placeholderIndex: 0, name: "Title", x: 0.72, y: 0.58, w: 11.85, h: 0.68, source: "system" },
          { key: "subtitle:0", placeholder: "subtitle", placeholderIndex: 0, name: "Subtitle", x: 0.72, y: 1.18, w: 11.85, h: 0.42, source: "system" },
          { key: "callout:0", placeholder: "callout", placeholderIndex: 0, name: "Callout", x: 0.72, y: 1.8, w: 11.85, h: 0.86, source: "system" },
          { key: "body:0", placeholder: "body", placeholderIndex: 0, name: "Body", x: 0.72, y: 2.86, w: 11.85, h: 3.82, source: "system" },
        ],
        notes: [],
      },
      {
        id: "two-column",
        name: "Two column",
        sourceName: "System Two Column",
        sourceMaster: "Basquio",
        placeholders: ["title", "body-left", "body-right", "chart"],
        regions: [
          { key: "title:0", placeholder: "title", placeholderIndex: 0, name: "Title", x: 0.72, y: 0.58, w: 11.85, h: 0.68, source: "system" },
          { key: "chart:0", placeholder: "chart", placeholderIndex: 0, name: "Chart", x: 0.72, y: 1.82, w: 6.05, h: 4.1, source: "system" },
          { key: "body-left:0", placeholder: "body-left", placeholderIndex: 0, name: "Body Left", x: 0.72, y: 1.82, w: 5.7, h: 4.28, source: "system" },
          { key: "body-right:0", placeholder: "body-right", placeholderIndex: 0, name: "Body Right", x: 6.98, y: 1.82, w: 5.59, h: 4.28, source: "system" },
        ],
        notes: [],
      },
      {
        id: "evidence-grid",
        name: "Evidence grid",
        sourceName: "System Evidence Grid",
        sourceMaster: "Basquio",
        placeholders: ["title", "metric-strip", "chart", "evidence-list"],
        regions: [
          { key: "title:0", placeholder: "title", placeholderIndex: 0, name: "Title", x: 0.72, y: 0.58, w: 11.85, h: 0.68, source: "system" },
          { key: "metric-strip:0", placeholder: "metric-strip", placeholderIndex: 0, name: "Metric Strip", x: 0.72, y: 1.42, w: 11.85, h: 1.02, source: "system" },
          { key: "chart:0", placeholder: "chart", placeholderIndex: 0, name: "Chart", x: 0.72, y: 2.68, w: 7.05, h: 3.56, source: "system" },
          { key: "evidence-list:0", placeholder: "evidence-list", placeholderIndex: 0, name: "Evidence", x: 8.02, y: 2.68, w: 4.55, h: 3.56, source: "system" },
        ],
        notes: [],
      },
    ],
  });
}

export async function interpretTemplateSource(input: TemplateInput): Promise<TemplateProfile> {
  const base = createSystemTemplateProfile();
  const fileName = input.sourceFile?.fileName ?? input.fileName;

  if (!fileName) {
    return templateProfileSchema.parse({
      ...base,
      id: input.id,
    });
  }

  const normalizedKind = inferSourceFileKind(fileName);

  if (normalizedKind === "brand-tokens" && input.sourceFile) {
    const text = Buffer.from(input.sourceFile.base64, "base64").toString("utf8");
    const extracted = fileName.toLowerCase().endsWith(".css")
      ? extractTokensFromCss(text)
      : extractTokensFromJson(text);

    return templateProfileSchema.parse(applyBrandTokens(base, input.id, extracted, [], fileName));
  }

  if (normalizedKind === "pptx" && input.sourceFile) {
    try {
      const profile = await parsePptxTemplate({
        id: input.id,
        fileName,
        base64: input.sourceFile.base64,
        base: createSystemTemplateProfile(),
        reviewFeedback: input.reviewFeedback,
      });
      return templateProfileSchema.parse(profile);
    } catch (error) {
      return templateProfileSchema.parse({
        ...base,
        id: input.id,
        sourceType: "pptx",
        templateName: fileName,
        sourceFingerprint: fingerprintBase64(input.sourceFile.base64),
        warnings: [
          `PPTX parsing fell back to the system template: ${error instanceof Error ? error.message : "Unknown parse failure."}`,
        ],
      });
    }
  }

  if (normalizedKind === "pdf") {
    return templateProfileSchema.parse({
      ...base,
      id: input.id,
      sourceType: "pdf-style-reference",
      templateName: fileName,
      sourceFingerprint: input.sourceFile ? fingerprintBase64(input.sourceFile.base64) : "",
      warnings: [`${fileName} is treated as a style reference only in v1.`],
    });
  }

  return templateProfileSchema.parse({
    ...base,
    id: input.id,
    templateName: fileName,
    sourceFingerprint: input.sourceFile ? fingerprintBase64(input.sourceFile.base64) : "",
  });
}

export {
  buildNoTemplateDiagnostics,
  buildTemplateDiagnosticsFromProfile,
  isTemplateDiagnostics,
  type TemplateDiagnostics,
} from "./diagnostics";

async function parsePptxTemplate(input: {
  id: string;
  fileName: string;
  base64: string;
  base: TemplateProfile;
  reviewFeedback?: string[];
}) {
  const buffer = Buffer.from(input.base64, "base64");
  const zip = await JSZip.loadAsync(buffer);
  const themeXml = await readZipText(zip, "ppt/theme/theme1.xml");
  const presentationXml = await readZipText(zip, "ppt/presentation.xml");
  const presentationRelsXml = await readZipText(zip, "ppt/_rels/presentation.xml.rels");
  const masters = await readMasterRegionMap(zip);
  const layoutEntries = Object.keys(zip.files).filter((entry) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/i.test(entry));
  const warnings: string[] = [];
  const sourceSlidesByLayout = await readSourceSlidesByLayout(zip, presentationXml, presentationRelsXml);

  const slideMetrics = inferSlideMetrics(presentationXml);
  const slideSize = slideMetrics.slideSize ?? input.base.slideSize;
  const coverBg = await extractCoverBackground(zip);
  const coverLogo = await extractCoverLogo(zip, slideMetrics.widthInches ?? input.base.slideWidthInches);
  const decorativeShapes = await extractDecorativeShapes(zip);
  const theme = extractTheme(themeXml, coverBg);
  const layouts = await Promise.all(
    layoutEntries.map(async (entry) =>
      extractLayout(
        zip,
        entry,
        path.basename(entry),
        input.base,
        masters,
        sourceSlidesByLayout.get(entry),
      ),
    ),
  );
  const parsedLayouts = layouts.filter((value): value is NonNullable<typeof value> => Boolean(value));

  if (!themeXml) {
    warnings.push("No OOXML theme file was found; Basquio reused system theme defaults.");
  }
  if (parsedLayouts.length === 0) {
    warnings.push("No PPTX slide layouts were extracted; Basquio reused system layout defaults.");
  }
  if (input.reviewFeedback?.length) {
    warnings.push(`Design translation reviewed ${input.reviewFeedback.length} revision cue${input.reviewFeedback.length === 1 ? "" : "s"} while re-reading the template.`);
  }

  const templateProfile = applyBrandTokens(
    input.base,
    input.id,
    {
      palette: theme.palette,
      typography: theme.typography,
      chartPalette: theme.chartPalette,
      logo: {
        ...coverLogo,
        treatment: "template-import",
      },
      decorativeShapes,
    },
    warnings,
    input.fileName,
    { inheritBrandingDefaults: false },
  );

  return {
    ...templateProfile,
    sourceType: "pptx" as const,
    templateName: input.fileName,
    themeName: theme.themeName || path.basename(input.fileName, path.extname(input.fileName)),
    sourceFingerprint: createHash("sha1").update(buffer).digest("hex"),
    slideSize,
    slideWidthInches: slideMetrics.widthInches ?? input.base.slideWidthInches,
    slideHeightInches: slideMetrics.heightInches ?? input.base.slideHeightInches,
    layouts: parsedLayouts.length > 0 ? parsedLayouts : templateProfile.layouts,
    placeholderCatalog:
      parsedLayouts.length > 0
        ? compactUnique(parsedLayouts.flatMap((layout) => layout.placeholders))
        : templateProfile.placeholderCatalog,
    warnings,
  };
}

async function extractLayout(
  zip: JSZip,
  entry: string,
  fallbackName: string,
  base: TemplateProfile,
  masterRegionMap: Map<string, ReturnType<typeof parsePlaceholderRegions>>,
  sourceSlide?: SourceSlideReference,
) {
  const xml = await readZipText(zip, entry);
  if (!xml) {
    return null;
  }

  const rawName = matchFirst(xml, /<p:cSld\b[^>]*name="([^"]+)"/i) || fallbackName;
  const relsEntry = entry.replace("slideLayouts/", "slideLayouts/_rels/") + ".rels";
  const relsXml = await readZipText(zip, relsEntry);
  const masterTarget = resolveLayoutMasterTarget(relsXml, entry);
  const layoutRegions = parsePlaceholderRegions(xml, "layout");
  const masterRegions = masterTarget ? masterRegionMap.get(masterTarget) ?? [] : [];
  const regions = mergePlaceholderRegions(
    layoutRegions,
    masterRegions,
    sourceSlide?.regions ?? [],
    base.layouts.find((layout) => layout.id === normalizePptxLayoutId(rawName, layoutRegions.map((region) => region.placeholder), base))?.regions ?? [],
  );
  const placeholders = compactUnique([
    ...regions.map((region) => region.placeholder),
    ...regions.map((region) => (region.placeholderIndex > 0 ? `placeholder-${region.placeholderIndex}` : undefined)),
  ]);

  const normalizedId = normalizePptxLayoutId(rawName, placeholders, base);
  const notes = compactUnique([
    placeholders.includes("chart") ? "Supports chart content." : undefined,
    placeholders.includes("body-left") || placeholders.includes("body-right") ? "Supports split narrative layouts." : undefined,
  ]);

  return {
    id: normalizedId,
    name: humanizeLayoutName(normalizedId, rawName),
    sourceName: rawName,
    sourceMaster: matchFirst(xml, /<p:clrMapOvr/i) ? "custom-master" : "default-master",
    sourceSlideNumber: sourceSlide?.sourceSlideNumber,
    sourceSlideName: sourceSlide?.sourceSlideName ?? "",
    placeholders: placeholders.length > 0 ? placeholders : base.layouts.find((layout) => layout.id === normalizedId)?.placeholders ?? ["title", "body"],
    regions: regions.length > 0 ? regions : base.layouts.find((layout) => layout.id === normalizedId)?.regions ?? [],
    notes,
  };
}

function applyBrandTokens(
  base: TemplateProfile,
  id: string,
  extracted: ExtractedBrandTokens,
  warnings: string[],
  templateName?: string,
  options?: {
    inheritBrandingDefaults?: boolean;
  },
) {
  const inheritBrandingDefaults = options?.inheritBrandingDefaults ?? true;
  const palette = inheritBrandingDefaults
    ? {
        ...base.brandTokens?.palette,
        ...extracted.palette,
      }
    : {
        ...(extracted.palette ?? {}),
      };
  const typography = {
    ...base.brandTokens?.typography,
    ...extracted.typography,
  };
  const spacing = {
    ...base.brandTokens?.spacing,
    ...extracted.spacing,
  };
  const logo = inheritBrandingDefaults
    ? {
        ...base.brandTokens?.logo,
        ...extracted.logo,
      }
    : {
        ...(extracted.logo ?? {}),
      };

  const decorativeShapes = extracted.decorativeShapes ?? base.brandTokens?.decorativeShapes ?? [];

  return {
    ...base,
    id,
    templateName: templateName || base.templateName,
    fonts: compactUnique([typography.headingFont, typography.bodyFont, typography.monoFont]),
    colors: compactUnique([
      palette.text,
      palette.accent,
      palette.highlight,
      palette.background,
      palette.surface,
      palette.border,
    ]),
    spacingTokens: [
      `pageX:${spacing.pageX}`,
      `pageY:${spacing.pageY}`,
      `sectionGap:${spacing.sectionGap}`,
      `blockGap:${spacing.blockGap}`,
    ],
    logoAssetHints: compactUnique([logo.wordmarkPath, logo.iconPath]),
    brandTokens: {
      palette,
      typography,
      spacing,
      logo,
      decorativeShapes,
      ...(extracted.chartPalette ? { chartPalette: extracted.chartPalette } : {}),
    },
    warnings,
  };
}

function extractTheme(raw: string, coverBg?: string) {
  // Extract OOXML theme color scheme properly:
  // Standard order: dk1, lt1, dk2, lt2, accent1, accent2, accent3, accent4, accent5, accent6, hlink, folHlink
  const schemeColors = new Map<string, string>();
  const schemeMatches = raw.matchAll(/<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>\s*<a:srgbClr\s+val="([0-9A-Fa-f]{6})"\s*\/?>/gim);
  for (const m of schemeMatches) {
    schemeColors.set(m[1].toLowerCase(), `#${m[2].toUpperCase()}`);
  }
  // Also try lastClr attribute for dk1/lt1
  const lastClrMatches = raw.matchAll(/<a:(dk1|lt1|dk2|lt2)>\s*<a:sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"/gim);
  for (const m of lastClrMatches) {
    if (!schemeColors.has(m[1].toLowerCase())) {
      schemeColors.set(m[1].toLowerCase(), `#${m[2].toUpperCase()}`);
    }
  }

  // Build palette from semantic theme slots
  const accent1 = schemeColors.get("accent1") ?? "#2563EB";
  const accent2 = schemeColors.get("accent2") ?? "#7C3AED";
  const accent3 = schemeColors.get("accent3") ?? "#059669";
  const accent4 = schemeColors.get("accent4") ?? "#D97706";
  const accent5 = schemeColors.get("accent5") ?? "#DC2626";
  const accent6 = schemeColors.get("accent6") ?? "#6366F1";
  const dk1 = schemeColors.get("dk1") ?? "#1F2937";
  const lt1 = schemeColors.get("lt1") ?? "#FFFFFF";
  const dk2 = schemeColors.get("dk2") ?? "#374151";
  const lt2 = schemeColors.get("lt2") ?? lt1;
  const resolvedCoverBg = coverBg ?? lt1;

  return {
    themeName: matchFirst(raw, /<a:theme\b[^>]*name="([^"]+)"/i),
    palette: {
      text: dk1,
      muted: dk2,
      accent: accent1,
      highlight: accent2,
      background: lt1,
      surface: lt2,
      border: dk2,
      accentMuted: accent3,
      accentLight: lt2,
      positive: accent3,
      negative: accent5,
      coverBg: resolvedCoverBg,
      calloutGreen: accent3,
      calloutOrange: accent4,
    },
    // Chart palette uses all 6 accent colors in order
    chartPalette: [accent1, accent2, accent3, accent4, accent5, accent6],
    typography: {
      headingFont: matchFirst(raw, /<a:majorFont>[\s\S]*?<a:latin[^>]*typeface="([^"]+)"/i) || "Aptos Display",
      bodyFont: matchFirst(raw, /<a:minorFont>[\s\S]*?<a:latin[^>]*typeface="([^"]+)"/i) || "Aptos",
      monoFont: matchFirst(raw, /<a:font\b[^>]*script="Jpan"[^>]*typeface="([^"]+)"/i) || "Aptos",
      titleSize: 24,
      bodySize: 12,
    },
  };
}

async function extractCoverBackground(zip: JSZip) {
  const slide1Xml = await readZipText(zip, "ppt/slides/slide1.xml");
  if (!slide1Xml) {
    return "#FFFFFF";
  }

  const bgMatch = slide1Xml.match(/<p:bg>[\s\S]*?<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/i);
  if (bgMatch?.[1]) {
    return `#${bgMatch[1].toUpperCase()}`;
  }

  // No explicit slide background in OOXML means white in practice for this client template path.
  return "#FFFFFF";
}

async function extractCoverLogo(zip: JSZip, slideWidthInches: number) {
  const slide1Xml = await readZipText(zip, "ppt/slides/slide1.xml");
  const slide1Rels = await readZipText(zip, "ppt/slides/_rels/slide1.xml.rels");
  if (!slide1Xml || !slide1Rels) {
    return {};
  }

  const relationshipTargets = readRelationshipTargets(slide1Rels, "ppt/slides/_rels/slide1.xml.rels");
  const pictureBlocks = slide1Xml.match(/<p:pic\b[\s\S]*?<\/p:pic>/gim) ?? [];

  for (const block of pictureBlocks) {
    const relId = matchFirst(block, /<a:blip\b[^>]*r:embed="([^"]+)"/i);
    const targetPath = relId ? relationshipTargets.get(relId) : undefined;
    if (!targetPath) {
      continue;
    }

    const mediaFile = zip.file(targetPath);
    if (!mediaFile) {
      continue;
    }

    const offMatch = block.match(/<a:off x="(\d+)" y="(\d+)"/i);
    const extMatch = block.match(/<a:ext cx="(\d+)" cy="(\d+)"/i);
    if (!offMatch || !extMatch) {
      continue;
    }

    const x = emuToInches(Number.parseInt(offMatch[1], 10));
    const y = emuToInches(Number.parseInt(offMatch[2], 10));
    const w = emuToInches(Number.parseInt(extMatch[1], 10));
    const h = emuToInches(Number.parseInt(extMatch[2], 10));

    if (!(y < 3.75 && w > 0.5 && w < 5 && h > 0.15 && h < 2 && w / Math.max(h, 0.1) > 1.5)) {
      continue;
    }

    const nearLeft = x < 4;
    const nearRight = x + w > slideWidthInches - 4;
    if (!nearLeft && !nearRight) {
      continue;
    }

    const data = await mediaFile.async("nodebuffer");
    if (data.length > 100_000) {
      continue;
    }

    const extension = path.extname(targetPath).toLowerCase();
    const mimeType = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";

    return {
      imageBase64: `data:${mimeType};base64,${data.toString("base64")}`,
      position: { x, y, w, h },
    };
  }

  return {};
}

async function extractDecorativeShapes(zip: JSZip) {
  const slide1Xml = await readZipText(zip, "ppt/slides/slide1.xml");
  if (!slide1Xml) {
    return [];
  }

  const decorativeShapes: NonNullable<TemplateProfile["brandTokens"]>["decorativeShapes"] = [];
  const shapeBlocks = slide1Xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/gim) ?? [];

  for (const block of shapeBlocks) {
    const off = block.match(/<a:off x="(\d+)" y="(\d+)"/i);
    const ext = block.match(/<a:ext cx="(\d+)" cy="(\d+)"/i);
    const fill = block.match(/<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/i);
    if (!off || !ext || !fill) {
      continue;
    }

    const x = emuToInches(Number.parseInt(off[1], 10));
    const y = emuToInches(Number.parseInt(off[2], 10));
    const w = emuToInches(Number.parseInt(ext[1], 10));
    const h = emuToInches(Number.parseInt(ext[2], 10));
    const color = `#${fill[1].toUpperCase()}`;
    const isAccentBar = (h > 3 && w < 2) || (w > 8 && h < 1);
    if (!isAccentBar) {
      continue;
    }

    decorativeShapes.push({ x, y, w, h, fill: color });
  }

  return decorativeShapes.slice(0, 3);
}

function inferSlideMetrics(raw: string) {
  const cx = Number(matchFirst(raw, /<p:sldSz\b[^>]*cx="(\d+)"/i));
  const cy = Number(matchFirst(raw, /<p:sldSz\b[^>]*cy="(\d+)"/i));

  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cy === 0) {
    return {
      slideSize: undefined,
      widthInches: undefined,
      heightInches: undefined,
    };
  }

  return {
    slideSize: cx / cy > 1.5 ? "LAYOUT_WIDE" : "LAYOUT_STANDARD",
    widthInches: emuToInches(cx),
    heightInches: emuToInches(cy),
  };
}

function normalizePptxLayoutId(rawName: string, placeholders: string[], base: TemplateProfile) {
  const normalized = rawName.toLowerCase();

  // Cover / title slide
  if (normalized.includes("title slide") || normalized.includes("cover") || placeholders.includes("subtitle")) {
    return "cover";
  }
  // Executive summary / section header
  if (normalized.includes("exec") || normalized.includes("section header") || normalized.includes("overview")) {
    return "exec-summary";
  }
  // Chart + split layout
  if (normalized.includes("chart") && (normalized.includes("split") || normalized.includes("text"))) {
    return "chart-split";
  }
  // Full-width chart
  if (normalized.includes("chart") || (placeholders.includes("chart") && !placeholders.includes("body-left"))) {
    return "title-chart";
  }
  // Two-column / comparison
  if (normalized.includes("two") || normalized.includes("comparison") || (placeholders.includes("body-left") && placeholders.includes("body-right"))) {
    return "two-column";
  }
  // Evidence grid (chart + table)
  if (placeholders.includes("tbl") && placeholders.includes("chart")) {
    return "evidence-grid";
  }
  // Metrics / KPI
  if (normalized.includes("metric") || normalized.includes("kpi") || normalized.includes("dashboard")) {
    return "metrics";
  }
  // Table-only
  if (normalized.includes("table") || (placeholders.includes("tbl") && !placeholders.includes("chart"))) {
    return "table";
  }
  // Bullets
  if (normalized.includes("bullet") || normalized.includes("list")) {
    return "title-bullets";
  }
  // Title + body
  if (normalized.includes("title and content") || normalized.includes("title, content")) {
    return "title-body";
  }
  // Summary / closing
  if (normalized.includes("summary") || normalized.includes("closing") || normalized.includes("takeaway")) {
    return "summary";
  }

  return base.layouts.find((layout) => layout.name.toLowerCase() === normalized)?.id || slugify(rawName);
}

function normalizePlaceholder(raw: string) {
  if (!raw) {
    return "body";
  }

  const normalized = raw.toLowerCase();
  if (normalized === "ctrtitle" || normalized === "title") return "title";
  if (normalized === "subTitle".toLowerCase()) return "subtitle";
  if (normalized === "body") return "body";
  if (normalized === "chart") return "chart";
  if (normalized === "tbl") return "evidence-list";
  if (normalized === "pic") return "media";
  if (normalized === "dt" || normalized === "ftr" || normalized === "sldnum") return normalized;
  return normalized;
}

function humanizeLayoutName(id: string, fallbackName: string) {
  if (id.includes("_")) {
    return id
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  return fallbackName;
}

function extractTokensFromJson(raw: string): ExtractedBrandTokens {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const colors = collectHexValues(parsed);
    const fonts = collectFontValues(parsed);
    const spacing = collectSpacingValues(parsed);
    const logoPath = findFirstString(parsed, ["logo", "wordmark", "icon"]);

    return {
      palette: {
        text: colors[0],
        accent: colors[1],
        accentMuted: colors[3],
        highlight: colors[2],
        background: colors[3],
        surface: colors[4],
        border: colors[5],
      },
      typography: {
        headingFont: fonts[0],
        bodyFont: fonts[1] ?? fonts[0],
        monoFont: fonts[2] ?? fonts[1] ?? fonts[0],
        titleSize: 24,
        bodySize: 12,
      },
      spacing: {
        ...spacing,
        cardRadius: 0.12,
      },
      logo: {
        wordmarkPath: logoPath,
        iconPath: logoPath,
        treatment: parsed.theme && typeof parsed.theme === "string" ? parsed.theme : "file-driven",
      },
    };
  } catch {
    return {};
  }
}

function extractTokensFromCss(raw: string): ExtractedBrandTokens {
  const colorMatches = [...raw.matchAll(/--(?:color|brand|accent|surface|background|text)[\w-]*:\s*([^;]+);/gim)].map((match) =>
    normalizeTokenValue(match[1]),
  );
  const fontMatches = [...raw.matchAll(/--(?:font|type)[\w-]*:\s*([^;]+);/gim)].map((match) =>
    normalizeTokenValue(match[1]).replace(/^["']|["']$/g, ""),
  );
  const spacingVars = [...raw.matchAll(/--(?:space|spacing)[\w-]*:\s*([^;]+);/gim)].map((match) =>
    normalizeSpacingValue(match[1]),
  );
  const logoMatch = raw.match(/--(?:logo|wordmark|icon)[\w-]*:\s*([^;]+);/im);

  return {
    palette: {
      text: colorMatches[0],
      accent: colorMatches[1],
      accentMuted: colorMatches[3],
      highlight: colorMatches[2],
      background: colorMatches[3],
      surface: colorMatches[4],
      border: colorMatches[5],
    },
    typography: {
      headingFont: fontMatches[0],
      bodyFont: fontMatches[1] ?? fontMatches[0],
      monoFont: fontMatches[2] ?? fontMatches[1] ?? fontMatches[0],
      titleSize: 24,
      bodySize: 12,
    },
    spacing: {
      pageX: spacingVars[0],
      pageY: spacingVars[1],
      sectionGap: spacingVars[2],
      blockGap: spacingVars[3],
      cardRadius: 0.12,
    },
    logo: {
      wordmarkPath: logoMatch ? normalizeTokenValue(logoMatch[1]) : undefined,
      iconPath: logoMatch ? normalizeTokenValue(logoMatch[1]) : undefined,
      treatment: "css-tokens",
    },
  };
}

function collectHexValues(value: unknown): string[] {
  const results: string[] = [];
  visitObject(value, (candidate) => {
    if (typeof candidate === "string" && /^#?[0-9a-f]{6}$/i.test(candidate.trim())) {
      const normalized = candidate.startsWith("#") ? candidate.trim() : `#${candidate.trim()}`;
      results.push(normalized);
    }
  });
  return compactUnique(results);
}

function collectFontValues(value: unknown): string[] {
  const results: string[] = [];
  visitObject(value, (candidate, key) => {
    if (typeof candidate === "string" && key && /(font|family|typeface)/i.test(key)) {
      results.push(candidate.replace(/^["']|["']$/g, ""));
    }
  });
  return compactUnique(results);
}

function collectSpacingValues(value: unknown) {
  const numbers: number[] = [];
  visitObject(value, (candidate, key) => {
    if (key && /(space|spacing|gap|padding|margin)/i.test(key)) {
      const normalized = normalizeSpacingValue(candidate);
      if (typeof normalized === "number") {
        numbers.push(normalized);
      }
    }
  });

  const pageX = numbers[0];
  const pageY = numbers[1] ?? numbers[0];
  const sectionGap = numbers[2] ?? numbers[0];
  const blockGap = numbers[3] ?? numbers[1] ?? numbers[0];

  return {
    ...(typeof pageX === "number" ? { pageX } : {}),
    ...(typeof pageY === "number" ? { pageY } : {}),
    ...(typeof sectionGap === "number" ? { sectionGap } : {}),
    ...(typeof blockGap === "number" ? { blockGap } : {}),
  };
}

function findFirstString(value: unknown, keys: string[]) {
  let result: string | undefined;

  visitObject(value, (candidate, key) => {
    if (!result && typeof candidate === "string" && key && keys.some((term) => key.toLowerCase().includes(term))) {
      result = candidate;
    }
  });

  return result;
}

function visitObject(
  value: unknown,
  visitor: (candidate: unknown, key?: string) => void,
  key?: string,
) {
  visitor(value, key);

  if (Array.isArray(value)) {
    value.forEach((candidate) => visitObject(candidate, visitor));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [childKey, childValue] of Object.entries(value)) {
    visitObject(childValue, visitor, childKey);
  }
}

async function readZipText(zip: JSZip, entry: string) {
  const file = zip.file(entry);
  return file ? await file.async("text") : "";
}

async function readMasterRegionMap(zip: JSZip) {
  const entries = Object.keys(zip.files).filter((entry) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/i.test(entry));
  const pairs = await Promise.all(
    entries.map(async (entry) => [entry, parsePlaceholderRegions(await readZipText(zip, entry), "master")] as const),
  );
  return new Map(pairs);
}

async function readSourceSlidesByLayout(
  zip: JSZip,
  presentationXml: string,
  presentationRelsXml: string,
) {
  const presentationRelations = readRelationshipTargets(
    presentationRelsXml,
    "ppt/presentation.xml",
  );
  const sourceSlidesByLayout = new Map<string, SourceSlideReference>();
  const slideIdEntries = [...presentationXml.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/gim)];

  for (const [index, match] of slideIdEntries.entries()) {
    const relationId = match[1];
    const slideEntry = presentationRelations.get(relationId);

    if (!slideEntry) {
      continue;
    }

    const slideXml = await readZipText(zip, slideEntry);
    const slideRelsXml = await readZipText(
      zip,
      slideEntry.replace("slides/", "slides/_rels/") + ".rels",
    );
    const layoutEntry = resolveSlideLayoutTarget(slideRelsXml, slideEntry);

    if (!layoutEntry || sourceSlidesByLayout.has(layoutEntry)) {
      continue;
    }

    sourceSlidesByLayout.set(layoutEntry, {
      sourceSlideNumber: index + 1,
      sourceSlideName: matchFirst(slideXml, /<p:cSld\b[^>]*name="([^"]+)"/i) || path.basename(slideEntry),
      regions: parseSlideFallbackRegions(slideXml),
    });
  }

  return sourceSlidesByLayout;
}

function parsePlaceholderRegions(
  xml: string,
  source: "layout" | "master",
) {
  const regions = [
    ...extractPlaceholderRegions(xml, "sp", source),
    ...extractPlaceholderRegions(xml, "graphicFrame", source),
    ...extractPlaceholderRegions(xml, "pic", source),
  ];

  return regions.sort((left, right) => left.y - right.y || left.x - right.x);
}

function extractPlaceholderRegions(
  xml: string,
  tag: "sp" | "graphicFrame" | "pic",
  source: "layout" | "master",
) {
  const pattern = new RegExp(`<p:${tag}\\b[\\s\\S]*?<\\/p:${tag}>`, "gim");
  const blocks = xml.match(pattern) ?? [];

  return blocks.flatMap((block) => {
    if (!block.includes("<p:ph")) {
      return [];
    }

    const placeholderType = normalizePlaceholder(matchFirst(block, /<p:ph\b[^>]*type="([^"]+)"/i) || "");
    const rawIndex = Number(matchFirst(block, /<p:ph\b[^>]*idx="(\d+)"/i) ?? "0");
    const name = matchFirst(block, /<p:cNvPr\b[^>]*name="([^"]+)"/i) || "";
    const x = Number(matchFirst(block, /<a:off\b[^>]*x="(\d+)"/i));
    const y = Number(matchFirst(block, /<a:off\b[^>]*y="(\d+)"/i));
    const cx = Number(matchFirst(block, /<a:ext\b[^>]*cx="(\d+)"/i));
    const cy = Number(matchFirst(block, /<a:ext\b[^>]*cy="(\d+)"/i));

    if (![x, y, cx, cy].every((value) => Number.isFinite(value) && value > 0)) {
      return [];
    }

    return [{
      key: `${placeholderType}:${rawIndex}`,
      placeholder: placeholderType,
      placeholderIndex: rawIndex,
      name,
      x: emuToInches(x),
      y: emuToInches(y),
      w: emuToInches(cx),
      h: emuToInches(cy),
      source,
    }];
  });
}

function parseSlideFallbackRegions(xml: string): TemplateProfile["layouts"][number]["regions"] {
  const records = [
    ...extractVisualRegions(xml, "sp"),
    ...extractVisualRegions(xml, "graphicFrame"),
    ...extractVisualRegions(xml, "pic"),
  ].sort((left, right) => left.y - right.y || left.x - right.x);

  if (records.length === 0) {
    return [];
  }

  const textRecords = records.filter((record) => record.kind === "text");
  const titleRecord = [...textRecords]
    .filter((record) => record.y < 2)
    .sort((left, right) => (right.w * right.h) - (left.w * left.h))[0];
  const subtitleRecord = textRecords.find((record) => record !== titleRecord && record.y < 2.6);
  const counts = new Map<string, number>();

  return records.map((record) => {
    const placeholder =
      record.kind === "chart"
        ? "chart"
        : record.kind === "media"
          ? "media"
          : record === titleRecord
            ? "title"
            : record === subtitleRecord
              ? "subtitle"
              : "body";
    const placeholderIndex = counts.get(placeholder) ?? 0;
    counts.set(placeholder, placeholderIndex + 1);

    return {
      key: `${placeholder}:${placeholderIndex}`,
      placeholder,
      placeholderIndex,
      name: record.name,
      x: record.x,
      y: record.y,
      w: record.w,
      h: record.h,
      source: "layout" as const,
    };
  });
}

function extractVisualRegions(
  xml: string,
  tag: "sp" | "graphicFrame" | "pic",
) {
  const pattern = new RegExp(`<p:${tag}\\b[\\s\\S]*?<\\/p:${tag}>`, "gim");
  const blocks = xml.match(pattern) ?? [];

  return blocks.flatMap((block) => {
    const name = matchFirst(block, /<p:cNvPr\b[^>]*name="([^"]+)"/i) || "";
    const x = Number(matchFirst(block, /<a:off\b[^>]*x="(\d+)"/i));
    const y = Number(matchFirst(block, /<a:off\b[^>]*y="(\d+)"/i));
    const cx = Number(matchFirst(block, /<a:ext\b[^>]*cx="(\d+)"/i));
    const cy = Number(matchFirst(block, /<a:ext\b[^>]*cy="(\d+)"/i));

    if (![x, y, cx, cy].every((value) => Number.isFinite(value) && value > 0)) {
      return [];
    }

    const kind =
      tag === "graphicFrame"
        ? "chart"
        : tag === "pic"
          ? "media"
          : block.includes("<p:txBody")
            ? "text"
            : "shape";

    if (kind === "shape") {
      return [];
    }

    return [{
      name,
      x: emuToInches(x),
      y: emuToInches(y),
      w: emuToInches(cx),
      h: emuToInches(cy),
      kind,
    }];
  });
}

function mergePlaceholderRegions(
  layoutRegions: ReturnType<typeof parsePlaceholderRegions>,
  masterRegions: ReturnType<typeof parsePlaceholderRegions>,
  slideRegions: TemplateProfile["layouts"][number]["regions"],
  fallbackRegions: TemplateProfile["layouts"][number]["regions"],
) {
  const merged = new Map<string, TemplateProfile["layouts"][number]["regions"][number]>();

  for (const region of [...masterRegions, ...layoutRegions]) {
    merged.set(region.key, region);
  }

  const regions = [...merged.values()];
  const canonicalized = canonicalizeBodyRegions(regions);

  if (canonicalized.length > 0) {
    return canonicalized;
  }

  if (slideRegions.length > 0) {
    return canonicalizeBodyRegions(slideRegions);
  }

  return fallbackRegions;
}

function canonicalizeBodyRegions(regions: TemplateProfile["layouts"][number]["regions"]) {
  const bodyLike = regions
    .filter((region) => region.placeholder === "body")
    .sort((left, right) => left.x - right.x || left.y - right.y);
  const next = [...regions];

  if (bodyLike.length >= 2) {
    const first = bodyLike[0];
    const second = bodyLike[1];
    replaceRegion(next, first.key, { ...first, key: `body-left:${first.placeholderIndex}`, placeholder: "body-left", name: first.name || "Body Left" });
    replaceRegion(next, second.key, { ...second, key: `body-right:${second.placeholderIndex}`, placeholder: "body-right", name: second.name || "Body Right" });
  }

  return next.sort((left, right) => left.y - right.y || left.x - right.x);
}

function replaceRegion(
  regions: TemplateProfile["layouts"][number]["regions"],
  key: string,
  value: TemplateProfile["layouts"][number]["regions"][number],
) {
  const index = regions.findIndex((region) => region.key === key);
  if (index >= 0) {
    regions.splice(index, 1, value);
  }
}

function resolveLayoutMasterTarget(relsXml: string, entry: string) {
  const target = matchFirst(
    relsXml,
    /<Relationship\b[^>]*Type="[^"]*\/slideMaster"[^>]*Target="([^"]+)"/i,
  );

  if (!target) {
    return undefined;
  }

  return normalizeZipPath(path.posix.join(path.posix.dirname(entry), target));
}

function resolveSlideLayoutTarget(relsXml: string, entry: string) {
  const target = matchFirst(
    relsXml,
    /<Relationship\b[^>]*Type="[^"]*\/slideLayout"[^>]*Target="([^"]+)"/i,
  );

  if (!target) {
    return undefined;
  }

  return normalizeZipPath(path.posix.join(path.posix.dirname(entry), target));
}

function readRelationshipTargets(relsXml: string, relativeTo: string) {
  const targets = new Map<string, string>();

  for (const match of relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/gim)) {
    const [, id, target] = match;
    targets.set(id, normalizeZipPath(path.posix.join(path.posix.dirname(relativeTo), target)));
  }

  return targets;
}

function normalizeZipPath(value: string) {
  return path.posix.normalize(value.replace(/\\/g, "/"));
}

function matchFirst(raw: string, regex: RegExp) {
  return raw.match(regex)?.[1];
}

function emuToInches(value: number) {
  return Number((value / 914400).toFixed(3));
}

function normalizeTokenValue(value: unknown) {
  return String(value ?? "").trim().replace(/^["']|["']$/g, "");
}

function normalizeSpacingValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const raw = normalizeTokenValue(value);
  const parsed = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed / (raw.endsWith("px") ? 16 : 1) : undefined;
}

function compactUnique(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim().length > 0)))];
}

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function fingerprintBase64(value: string) {
  return createHash("sha1").update(Buffer.from(value, "base64")).digest("hex");
}
