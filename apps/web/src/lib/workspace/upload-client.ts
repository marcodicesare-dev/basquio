"use client";

import * as tus from "tus-js-client";

type PreparedWorkspaceUpload = {
  provisionalId: string;
  fileName: string;
  mediaType: string;
  storageBucket: string;
  storagePath: string;
  fileBytes: number;
  uploadMode: "standard" | "resumable";
  signedUrl?: string;
  resumableUrl?: string;
  chunkSizeBytes?: number;
  token?: string;
  contentHash: string;
};

type PrepareWorkspaceUploadResponse =
  | {
      deduplicated: true;
      id: string;
      status: string;
      fileName: string;
      contentHash: string;
    }
  | {
      deduplicated?: false;
      upload: PreparedWorkspaceUpload;
    };

type ConfirmWorkspaceUploadResponse = {
  id: string;
  status: string;
  deduplicated: boolean;
  fileName: string;
  /** True when a conversation_attachments row was written (dual-lane Lane A). */
  attachedToConversation?: boolean;
};

type UploadWorkspaceFileOptions = {
  note?: string | null;
  onProgress?: (progressPct: number) => void;
  /**
   * Dual-lane spec (docs/specs/2026-04-21-dual-lane-workspace-chat-deck-architecture-spec.md):
   * when present, the confirm route records a conversation_attachments row so
   * the file is rank-1 retrievable in this chat even while Lane B indexing is
   * still running. Both ids are UUIDs; the server validates ownership.
   */
  conversationId?: string | null;
  scopeId?: string | null;
};

export async function uploadWorkspaceFile(
  file: File,
  options: UploadWorkspaceFileOptions = {},
): Promise<ConfirmWorkspaceUploadResponse> {
  const contentHash = await hashFile(file);
  const conversationId = options.conversationId ?? null;
  const scopeId = options.scopeId ?? null;

  const prepareResponse = await fetch("/api/workspace/uploads/prepare", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fileName: file.name,
      mediaType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      contentHash,
      note: options.note ?? null,
    }),
  });
  const preparePayload = (await readJson(prepareResponse)) as PrepareWorkspaceUploadResponse & { error?: string };

  if (!prepareResponse.ok) {
    throw new Error(preparePayload.error ?? `Unable to prepare upload for ${file.name}.`);
  }

  if ("deduplicated" in preparePayload && preparePayload.deduplicated) {
    options.onProgress?.(100);
    // Dedup hit: still let the server record a conversation_attachment so the
    // freshly attached dedup'd doc is rank-1 in the current chat. A tiny
    // extra round trip is cheaper than leaving the file invisible to
    // retrieval.
    const attachResponse = await fetch("/api/workspace/uploads/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deduplicatedDocumentId: preparePayload.id,
        contentHash: preparePayload.contentHash,
        conversationId,
        scopeId,
      }),
    });
    const attachPayload = (await readJson(attachResponse)) as ConfirmWorkspaceUploadResponse & {
      error?: string;
    };
    if (attachResponse.ok) {
      return {
        id: attachPayload.id ?? preparePayload.id,
        status: attachPayload.status ?? preparePayload.status,
        deduplicated: true,
        fileName: attachPayload.fileName ?? preparePayload.fileName,
        attachedToConversation: attachPayload.attachedToConversation ?? false,
      };
    }
    // Attach call failed; return the dedup result anyway so the upload still
    // looks successful. The file is in workspace memory; the user can retry
    // attaching by re-dropping.
    return {
      id: preparePayload.id,
      status: preparePayload.status,
      deduplicated: true,
      fileName: preparePayload.fileName,
      attachedToConversation: false,
    };
  }

  await uploadPreparedWorkspaceFile(file, preparePayload.upload, options.onProgress);

  const confirmResponse = await fetch("/api/workspace/uploads/confirm", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      provisionalId: preparePayload.upload.provisionalId,
      fileName: preparePayload.upload.fileName,
      mediaType: preparePayload.upload.mediaType,
      sizeBytes: preparePayload.upload.fileBytes,
      storageBucket: preparePayload.upload.storageBucket,
      storagePath: preparePayload.upload.storagePath,
      contentHash: preparePayload.upload.contentHash,
      note: options.note ?? null,
      conversationId,
      scopeId,
    }),
  });
  const confirmPayload = (await readJson(confirmResponse)) as ConfirmWorkspaceUploadResponse & { error?: string };

  if (!confirmResponse.ok) {
    throw new Error(confirmPayload.error ?? `Unable to confirm upload for ${file.name}.`);
  }

  options.onProgress?.(100);
  return confirmPayload;
}

async function uploadPreparedWorkspaceFile(
  file: File,
  upload: PreparedWorkspaceUpload,
  onProgress?: (progressPct: number) => void,
) {
  if (upload.uploadMode === "resumable") {
    try {
      await uploadPreparedWorkspaceFileResumable(file, upload, onProgress);
      return;
    } catch (error) {
      if (!upload.signedUrl) {
        throw error;
      }
    }
  }

  await uploadPreparedWorkspaceFileStandard(file, upload, onProgress);
}

async function uploadPreparedWorkspaceFileStandard(
  file: File,
  upload: PreparedWorkspaceUpload,
  onProgress?: (progressPct: number) => void,
) {
  if (!upload.signedUrl) {
    throw new Error(`No signed upload URL returned for ${file.name}.`);
  }

  const response = await fetch(upload.signedUrl, {
    method: "PUT",
    headers: {
      "cache-control": "3600",
      "content-type": file.type || upload.mediaType || "application/octet-stream",
      "x-upsert": "true",
    },
    body: file,
  });

  if (!response.ok) {
    const payload = (await readJson(response)) as { error?: string };
    throw new Error(payload.error ?? `Unable to upload ${file.name}.`);
  }

  onProgress?.(100);
}

async function uploadPreparedWorkspaceFileResumable(
  file: File,
  upload: PreparedWorkspaceUpload,
  onProgress?: (progressPct: number) => void,
) {
  if (!upload.resumableUrl || !upload.token) {
    throw new Error(`No resumable upload target returned for ${file.name}.`);
  }

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required for resumable uploads.");
  }

  const uploadTask = new tus.Upload(file, {
    endpoint: upload.resumableUrl,
    chunkSize: upload.chunkSizeBytes,
    retryDelays: [0, 1000, 3000, 5000],
    removeFingerprintOnSuccess: true,
    uploadDataDuringCreation: true,
    metadata: {
      bucketName: upload.storageBucket,
      objectName: upload.storagePath,
      contentType: file.type || upload.mediaType || "application/octet-stream",
      cacheControl: "3600",
    },
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      "x-signature": upload.token,
      "x-upsert": "true",
    },
    onProgress(bytesSent, bytesTotal) {
      if (bytesTotal > 0) {
        onProgress?.(Math.round((bytesSent / bytesTotal) * 100));
      }
    },
  });

  const previousUploads = await uploadTask.findPreviousUploads();
  if (previousUploads[0]) {
    uploadTask.resumeFromPreviousUpload(previousUploads[0]);
  }

  await new Promise<void>((resolve, reject) => {
    uploadTask.options.onError = (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    uploadTask.options.onSuccess = () => resolve();
    uploadTask.start();
  });
}

async function hashFile(file: File) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
