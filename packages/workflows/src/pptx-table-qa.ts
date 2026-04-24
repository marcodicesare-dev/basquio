import JSZip from "jszip";

import type { DeckManifest } from "./deck-manifest";

export async function evaluateNativeTableCoverage(
  zip: JSZip,
  manifest: DeckManifest,
) {
  const slidesWithNativeTables = await collectSlidesWithNativeTables(zip);
  const slidesExpectingNativeTables = manifest.slides
    .filter((slide) => slide.hasDataTable === true || usesTableArchetype(slide.layoutId) || usesTableArchetype(slide.slideArchetype))
    .map((slide) => slide.position)
    .sort((left, right) => left - right);
  const slidesMissingNativeTables = slidesExpectingNativeTables
    .filter((position) => !slidesWithNativeTables.has(position));

  return {
    slidesExpectingNativeTables,
    slidesMissingNativeTables,
    slidesWithNativeTables: [...slidesWithNativeTables].sort((left, right) => left - right),
  };
}

export async function collectSlidesWithNativeTables(zip: JSZip) {
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => extractSlideNumber(left) - extractSlideNumber(right));
  const slidesWithNativeTables = new Set<number>();

  for (const slideEntry of slideEntries) {
    const slideXml = await zip.file(slideEntry)?.async("string");
    if (slideXml?.includes("<a:tbl>")) {
      slidesWithNativeTables.add(extractSlideNumber(slideEntry));
    }
  }

  return slidesWithNativeTables;
}

function usesTableArchetype(value: string | undefined) {
  return /\btable\b/i.test(value ?? "");
}

function extractSlideNumber(path: string) {
  return Number(path.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
}
