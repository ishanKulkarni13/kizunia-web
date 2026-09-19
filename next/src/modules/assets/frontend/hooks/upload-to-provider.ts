/**
 * The one place in the frontend that knows how to physically post a file to
 * a storage provider's direct-upload endpoint. Isolated so a future
 * provider change only touches this file, not every uploader component.
 *
 * Deliberately does not parse or trust the provider's response body — the
 * server re-confirms the upload from the provider's own API during
 * finalize (see docs/architecture/domain/assets/security.md). Only success
 * or failure of the HTTP request itself matters here.
 */
export function uploadFileToProvider({
  uploadUrl,
  params,
  file,
  onProgress,
}: {
  uploadUrl: string;
  params: Record<string, string | number>;
  file: Blob;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();

    Object.entries(params).forEach(([key, value]) => {
      form.append(key, String(value));
    });

    form.append("file", file);

    const xhr = new XMLHttpRequest();

    xhr.open("POST", uploadUrl);

    xhr.upload.onprogress = (event: ProgressEvent<EventTarget>) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error("Upload to the storage provider failed."));
      }
    };

    xhr.onerror = () => reject(new Error("Upload to the storage provider failed."));

    xhr.send(form);
  });
}
