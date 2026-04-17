# Template Import Fix Spec

**Date:** 2026-04-16
**Priority:** P0 — blocks real user testing (FELFEL template import)
**Root cause:** Vercel 413 Payload Too Large + zero user feedback

---

## What happened

Marco created `marco.dicesare@felfel.ch`, tried to import the FELFEL Slide Library (15.6 MB PPTX). Two attempts, both rejected by Vercel at the platform level (HTTP 413) before the function ever executed. The UI showed "Import failed. Try again." with zero explanation. ~15 minutes wasted.

**Vercel log evidence:**
```
06:54:36 | /api/templates/import | 413 | no duration, no region, no memory (function never ran)
07:04:09 | /api/templates/import | 413 | same — tried again 10 min later
```

---

## Problem 1: Vercel body size limit

Vercel serverless functions have a hard **4.5 MB request body limit on all plans** (Hobby, Pro, Enterprise — same limit). The current import route (`apps/web/src/app/api/templates/import/route.ts`) receives the entire file as `multipart/form-data` through the Vercel function. A 15.6 MB PPTX triggers `413: FUNCTION_PAYLOAD_TOO_LARGE` at the platform level — the function never executes.

Corporate PPTX templates routinely exceed 10 MB (embedded images, master slides, sample content). This isn't an edge case — it's the normal case for the ICP.

### Fix: Presigned upload to Supabase Storage

**Current flow (broken):**
```
Browser → [upload file body] → Vercel function → Supabase Storage
                                 ↑ 413 here
```

**New flow:**
```
Browser → Vercel function (GET presigned URL, ~200 bytes) → returns signed URL
Browser → [upload file body] → Supabase Storage directly (no Vercel limit)
Browser → Vercel function (POST metadata, ~500 bytes) → creates DB records + queues job
```

#### Step 1: New API route `POST /api/templates/prepare-upload`

Request body (tiny JSON, no file):
```json
{
  "fileName": "FELFEL Slide Library.pptx",
  "fileSize": 15607937,
  "name": "FELFEL Slide Library",
  "setAsDefault": false
}
```

Server validates:
- Auth + workspace
- File extension is .pptx, .json, .css, or .pdf
- File size <= 50 MB (hard cap)
- Generates `sourceFileId`, `storagePath`
- Creates a Supabase Storage presigned upload URL (`POST /storage/v1/object/upload/sign/{bucket}/{path}`)
- Returns `{ uploadUrl, sourceFileId, storagePath, expiresAt }`

#### Step 2: Client uploads directly to Supabase Storage

```typescript
const response = await fetch(uploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': file.type || 'application/octet-stream' },
  body: file,
});
```

This bypasses Vercel entirely. The `source-files` bucket has no file_size_limit configured — Supabase Pro supports up to 5 GB per upload.

#### Step 3: New API route `POST /api/templates/confirm-upload`

Request body (tiny JSON):
```json
{
  "sourceFileId": "...",
  "storagePath": "...",
  "fileName": "FELFEL Slide Library.pptx",
  "fileSize": 15607937,
  "name": "FELFEL Slide Library",
  "setAsDefault": false
}
```

Server:
- Verifies the file exists in storage (HEAD request)
- Creates `source_files` row
- Creates `template_profiles` row (status: processing)
- Creates `template_import_jobs` row (status: queued)
- Returns `{ importJobId, templateProfileId, status: "queued" }`

#### Step 4: Keep existing route as fallback

Keep `POST /api/templates/import` for files < 4 MB (JSON/CSS brand tokens). The client chooses the path based on file size.

### Files to create/modify

| File | Action |
|------|--------|
| `apps/web/src/app/api/templates/prepare-upload/route.ts` | **Create** — presigned URL generation |
| `apps/web/src/app/api/templates/confirm-upload/route.ts` | **Create** — DB records + queue job |
| `apps/web/src/components/template-library.tsx` | **Modify** — new upload flow with progress |
| `apps/web/src/app/api/templates/import/route.ts` | **Keep** — fallback for small files |
| `packages/template-engine/src/index.ts` | **Modify** — logo extraction: search layouts, relax filters |

---

## Problem 2: Horrible UX / zero feedback

### Current UX failures

1. **No client-side file size check.** Any file is accepted by the drop zone regardless of size.
2. **No upload progress.** A 15 MB upload takes 5-15 seconds on a typical connection. The user sees "Importing..." with zero progress indication.
3. **413 error is unrecoverable in code.** Vercel returns HTML (not JSON) for 413. The `response.json()` call throws, falling into the generic catch: "Import failed. Try again." — no explanation of *why*.
4. **No file size display.** User doesn't know if their file is too large.
5. **Polling timeout message is misleading.** "This can take a little longer on larger templates. We'll email you when it's ready." — but the upload already failed. The job was never created.
6. **No distinction between upload failure and processing failure.** Both show the same vague message.

### Required UX fixes

#### A. Client-side validation (before upload)

```typescript
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

function handleImport(file: File) {
  if (file.size > MAX_FILE_SIZE) {
    setImportMessage(`File too large (${formatBytes(file.size)}). Maximum is 50 MB.`);
    return;
  }
  if (file.size === 0) {
    setImportMessage("File is empty.");
    return;
  }
  // proceed with upload
}
```

#### B. Upload progress indicator

Use `XMLHttpRequest` or a `ReadableStream` wrapper to track upload progress:

```typescript
// Show: "Uploading... 45% (7.0 / 15.6 MB)"
```

Minimum viable: show file size and a spinner. Better: show actual percentage.

#### C. Clear error messages

| Scenario | Current message | Required message |
|----------|----------------|-----------------|
| File > 50 MB | "Import failed. Try again." | "This file is too large (67 MB). Templates must be under 50 MB. Try removing embedded images or sample slides." |
| File > 4.5 MB (413 from Vercel, old path) | "Import failed. Try again." | Should never happen — large files use presigned upload |
| Network error during upload | "Import failed. Try again." | "Upload interrupted. Check your connection and try again." |
| Worker processing failure | "Template import failed. Check the card below for details." | Keep as-is (this one is okay) |
| Unsupported file type | "Template files must be PPTX, JSON, CSS, or PDF." | Keep as-is |

#### D. Upload state machine

Replace the boolean `importing` + string `importMessage` with an explicit state:

```typescript
type ImportState =
  | { phase: 'idle' }
  | { phase: 'validating' }
  | { phase: 'uploading'; progress: number; totalBytes: number }
  | { phase: 'processing'; templateId: string }
  | { phase: 'success'; templateId: string }
  | { phase: 'error'; message: string; recoverable: boolean };
```

This prevents impossible states (e.g., "importing" is true but there's also a success message).

---

## Problem 3: Logo extraction fails for FELFEL (and most corporate templates)

### FELFEL PPTX forensic findings (verified via JSZip analysis)

- **15.6 MB compressed**, 17.4 MB uncompressed (15.1 MB media, 2.2 MB XML)
- **51 slides**, 21 layouts, 1 slide master
- **Theme:** "FELFEL Master" — Brandon Grotesque Regular (major), Helvetica (minor)
- **Slide size:** 10.83 × 7.50 inches (standard 4:3, NOT widescreen)
- **Logo:** `image2.png` (0.3 KB), named "Symbol", at position (0.07, 1.09), size **0.30 × 0.35 inches**
- **Logo location:** In **slide layouts** 3, 9, 10, 11, 12, 13, 21 — NOT in slide 1, NOT in slide masters

### Root cause: `extractCoverLogo()` never finds the FELFEL logo (3 bugs)

**Bug 1: Layouts are never searched.** `extractCoverLogo()` (line 507-529) searches slide 1 and all slide masters. It never searches slide layouts. The FELFEL logo is ONLY in slide layouts — it will never be found.

**Bug 2: Shape filter rejects small logos.** The size filter (line 572) requires `w > 0.5`. The FELFEL logo is 0.30 inches wide → rejected. Many corporate logos on slide layouts are small marks, not banner-width images.

**Bug 3: Aspect ratio filter rejects square/portrait logos.** The filter requires `w / h > 1.5` (landscape). The FELFEL logo is 0.30 × 0.35 (aspect ratio 0.86, nearly square) → rejected. Many logos (app icons, monograms, stacked wordmarks) are square or portrait-oriented.

The 100 KB size filter (line 585) is NOT the problem for FELFEL — the logo is only 0.3 KB. But 100 KB is still too aggressive for high-res corporate logos in other templates (keep the increase to 500 KB as a secondary fix).

### Required fixes

1. **Search slide layouts for logos.** Add layout iteration to `extractCoverLogo()`, after slide 1 and slide masters:
   ```typescript
   // After master loop, before returning {}:
   const layoutEntries = Object.keys(zip.files)
     .filter((e) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/i.test(e))
     .sort();
   for (const layoutEntry of layoutEntries) {
     const relsEntry = layoutEntry.replace("slideLayouts/", "slideLayouts/_rels/") + ".rels";
     const layoutLogo = await extractLogoFromSlideXml(zip, layoutEntry, relsEntry, slideWidthInches);
     if (layoutLogo) return layoutLogo;
   }
   ```

2. **Relax shape filter for small images.** Lower minimum width from 0.5 to 0.15 inches. Logos on layouts can be compact marks:
   ```typescript
   // Old: w > 0.5 && w < 5 && h > 0.15 && h < 2 && w / Math.max(h, 0.1) > 1.5
   // New: w > 0.15 && w < 5 && h > 0.15 && h < 3 && w / Math.max(h, 0.1) > 0.5
   ```
   The `> 0.5` aspect ratio allows square logos and slightly portrait marks while still rejecting tall narrow shapes (decorative bars, vertical dividers).

3. **Increase logo file size limit to 500 KB.** The 100 KB limit (line 585) is correct to filter out full-bleed background photos, but too aggressive for high-res logos. 500 KB accommodates retina-ready PNG logos without accepting background images.

4. **Add memory-safe JSZip options.** Use `{optimizedBinaryString: true}` and limit which entries are extracted (only `ppt/theme/`, `ppt/slideLayouts/`, `ppt/slideMasters/`, `ppt/presentation.xml` — skip `ppt/media/` except for logo candidates).

5. **Add file size to worker log.** Currently the worker doesn't log the source file size, making debugging impossible.

6. **Increase stale threshold for template imports.** 5 minutes → 10 minutes. JSZip parsing + theme extraction for a 15 MB file is I/O-bound and can approach the 5-min limit.

---

## Implementation order

1. **UX fixes (1-2 hours):** Client-side file size validation + clear error messages + upload progress. This prevents the broken experience even before the presigned upload is ready.
2. **Presigned upload flow (2-3 hours):** `prepare-upload` + `confirm-upload` routes + client integration. This removes the Vercel body size limit permanently.
3. **Logo extraction fix (1 hour):** Search slide layouts, relax shape/aspect filters, increase size limit. This ensures the FELFEL logo (and similar small/square logos in layouts) is actually found.
4. **Template engine hardening (30 min):** JSZip optimization, file size logging, stale threshold increase.

---

## Acceptance criteria

- [ ] FELFEL Slide Library (15.6 MB) imports successfully end-to-end
- [ ] Upload shows progress percentage for files > 1 MB
- [ ] Files > 50 MB are rejected client-side with clear message before upload starts
- [ ] Network errors during upload show actionable message
- [ ] Template import jobs for large files don't get marked stale prematurely
- [ ] FELFEL logo (0.30×0.35 "Symbol" in slide layouts) is correctly extracted
- [ ] Logo extraction searches slide layouts, not just slide 1 and slide masters
- [ ] Small logos (≥0.15 inches) and square/portrait logos are accepted by shape filter
- [ ] Logo extraction works for images up to 500 KB
- [ ] All error states show specific, human-readable messages — never "Import failed. Try again."
