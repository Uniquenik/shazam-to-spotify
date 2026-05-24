import { PreparedSource, SourceInput } from "../../entities/source/model/types";
import { isLikelyDirectAudioUrl } from "../lib/direct-audio-url";

const MAX_SOURCE_BYTES = 200 * 1024 * 1024;

export type SourceDownloadProgress = {
  downloadedBytes: number;
  totalBytes?: number;
};

export async function resolveSource(
  source: SourceInput,
  onProgress?: (payload: SourceDownloadProgress) => void,
): Promise<PreparedSource> {
  if (source.type === "file") {
    if (source.file.size > MAX_SOURCE_BYTES) {
      throw new Error("Файл слишком большой для браузерной обработки в MVP.");
    }

    return {
      sourceType: "file",
      sourceName: source.file.name,
      blob: source.file,
      mimeType: source.file.type || "audio/mpeg",
      bytes: source.file.size,
    };
  }

  if (!isLikelyDirectAudioUrl(source.url)) {
    throw new Error(
      "URL должен указывать напрямую на аудиофайл вроде .mp3, .wav или .m4a.",
    );
  }

  let response: Response;

  try {
    response = await fetch("/api/fetch-audio", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: source.url,
      }),
    });
  } catch {
    throw new Error(
      "Не удалось загрузить файл через proxy. Проверьте, что URL публично доступен.",
    );
  }

  if (!response.ok) {
    throw new Error(`Источник по URL недоступен через proxy: HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const totalBytesRaw = response.headers.get("content-length");
  const totalBytes = totalBytesRaw ? Number(totalBytesRaw) : undefined;

  if (contentType && !contentType.startsWith("audio/") && !contentType.includes("octet-stream")) {
    throw new Error("URL не похож на прямую ссылку на аудиофайл.");
  }

  const reader = response.body?.getReader();

  if (!reader) {
    const blob = await response.blob();

    if (blob.size > MAX_SOURCE_BYTES) {
      throw new Error("Удаленный файл слишком большой для SPA-only MVP.");
    }

    onProgress?.({
      downloadedBytes: blob.size,
      totalBytes,
    });

    return {
      sourceType: "direct-url",
      sourceName: source.url.split("/").pop() || source.url,
      blob,
      mimeType: contentType || blob.type || "audio/mpeg",
      bytes: blob.size,
    };
  }

  const chunks: ArrayBuffer[] = [];
  let downloadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      const chunkCopy = new Uint8Array(value.byteLength);
      chunkCopy.set(value);
      chunks.push(chunkCopy.buffer);
      downloadedBytes += value.byteLength;

      if (downloadedBytes > MAX_SOURCE_BYTES) {
        throw new Error("Удаленный файл слишком большой для SPA-only MVP.");
      }

      onProgress?.({
        downloadedBytes,
        totalBytes,
      });
    }
  }

  const blob = new Blob(chunks, {
    type: contentType || "audio/mpeg",
  });

  if (blob.size > MAX_SOURCE_BYTES) {
    throw new Error("Удаленный файл слишком большой для SPA-only MVP.");
  }

  onProgress?.({
    downloadedBytes: blob.size,
    totalBytes: totalBytes ?? blob.size,
  });

  return {
    sourceType: "direct-url",
    sourceName: source.url.split("/").pop() || source.url,
    blob,
    mimeType: contentType || blob.type || "audio/mpeg",
    bytes: blob.size,
  };
}
