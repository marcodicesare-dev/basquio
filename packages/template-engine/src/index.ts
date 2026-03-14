import { inferSourceFileKind } from "@basquio/core";

import { templateProfileSchema, type TemplateProfile } from "@basquio/types";

type TemplateInput = {
  id: string;
  fileName?: string;
  sourceFile?: {
    fileName: string;
    mediaType?: string;
    base64: string;
  };
};

type ExtractedBrandTokens = {
  palette?: Partial<NonNullable<TemplateProfile["brandTokens"]>["palette"]>;
  typography?: Partial<NonNullable<TemplateProfile["brandTokens"]>["typography"]>;
  spacing?: Partial<NonNullable<TemplateProfile["brandTokens"]>["spacing"]>;
  logo?: Partial<NonNullable<TemplateProfile["brandTokens"]>["logo"]>;
};

export function createSystemTemplateProfile(): TemplateProfile {
  return templateProfileSchema.parse({
    id: "system-default",
    sourceType: "system",
    slideSize: "LAYOUT_WIDE",
    fonts: ["Aptos", "Aptos Display"],
    colors: ["#0B0C0C", "#1A6AFF", "#F0CC27", "#F8FAFC", "#FFFFFF", "#CBD5E1"],
    spacingTokens: ["pageX:0.6", "pageY:0.5", "sectionGap:0.32", "blockGap:0.2"],
    logoAssetHints: [
      "/brand/svg/logo/basquio-logo-dark-bg.svg",
      "/brand/svg/icon/basquio-icon-amber.svg",
    ],
    brandTokens: {
      palette: {
        text: "#0B0C0C",
        background: "#F8FAFC",
        surface: "#FFFFFF",
        accent: "#1A6AFF",
        accentMuted: "#DBEAFE",
        highlight: "#F0CC27",
        border: "#CBD5E1",
      },
      typography: {
        headingFont: "Aptos Display",
        bodyFont: "Aptos",
        monoFont: "Aptos",
        titleSize: 24,
        bodySize: 12,
      },
      spacing: {
        pageX: 0.6,
        pageY: 0.5,
        sectionGap: 0.32,
        blockGap: 0.2,
        cardRadius: 0.12,
      },
      logo: {
        wordmarkPath: "/brand/svg/logo/basquio-logo-dark-bg.svg",
        iconPath: "/brand/svg/icon/basquio-icon-amber.svg",
        treatment: "default",
      },
    },
    layouts: [
      {
        id: "cover",
        name: "Cover",
        placeholders: ["eyebrow", "title", "subtitle", "body"],
      },
      {
        id: "summary",
        name: "Summary",
        placeholders: ["title", "subtitle", "body", "callout"],
      },
      {
        id: "two-column",
        name: "Two column",
        placeholders: ["title", "body-left", "body-right", "chart"],
      },
      {
        id: "evidence-grid",
        name: "Evidence grid",
        placeholders: ["title", "metric-strip", "chart", "evidence-list"],
      },
    ],
  });
}

export function interpretTemplateSource(input: TemplateInput): TemplateProfile {
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

    return templateProfileSchema.parse(applyBrandTokens(base, input.id, extracted, []));
  }

  if (normalizedKind === "pptx") {
    return templateProfileSchema.parse({
      ...base,
      id: input.id,
      sourceType: "pptx",
      warnings: ["PPTX template parsing is still shallow in v1; Basquio preserves the template source type and layout contract while using the shared renderer profile."],
    });
  }

  if (normalizedKind === "pdf") {
    return templateProfileSchema.parse({
      ...base,
      id: input.id,
      sourceType: "pdf-style-reference",
      warnings: [`${fileName} is treated as a style reference only in v1.`],
    });
  }

  return templateProfileSchema.parse({
    ...base,
    id: input.id,
  });
}

function applyBrandTokens(
  base: TemplateProfile,
  id: string,
  extracted: ExtractedBrandTokens,
  warnings: string[],
) {
  const palette = {
    ...base.brandTokens?.palette,
    ...extracted.palette,
  };
  const typography = {
    ...base.brandTokens?.typography,
    ...extracted.typography,
  };
  const spacing = {
    ...base.brandTokens?.spacing,
    ...extracted.spacing,
  };
  const logo = {
    ...base.brandTokens?.logo,
    ...extracted.logo,
  };

  return {
    ...base,
    id,
    sourceType: "brand-tokens" as const,
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
    },
    warnings,
  };
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
