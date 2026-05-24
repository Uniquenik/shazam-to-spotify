import {
  RecognitionCandidate,
  RecognitionChunk,
  RecognizerProvider,
} from "./types";

export class ProxyRecognizeError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`Proxy recognize failed: ${status}`);
    this.status = status;
    this.body = body;
  }
}

type ShazamTrackResponse = {
  matches?: Array<{
    id?: string;
    offset?: number;
    timeskew?: number;
    frequencyskew?: number;
  }>;
  track?: {
    key?: string;
    title?: string;
    subtitle?: string;
    sections?: Array<{
      type?: string;
      metadata?: Array<{ title?: string; text?: string }>;
    }>;
  };
};

function inferAlbum(payload: ShazamTrackResponse["track"]) {
  if (!payload?.sections) {
    return undefined;
  }

  for (const section of payload.sections) {
    if (!section.metadata) {
      continue;
    }

    for (const item of section.metadata) {
      if (item.title?.toLowerCase() === "album" && item.text) {
        return item.text;
      }
    }
  }

  return undefined;
}

export class ShazamProxyRecognizerProvider implements RecognizerProvider {
  readonly id = "shazam-proxy";

  async recognize(chunk: RecognitionChunk): Promise<RecognitionCandidate | null> {
    const sampleMs =
      chunk.shazamSampleMs ??
      Math.max(
        1000,
        Math.round((chunk.endSec - chunk.startSec) * 1000),
      );

    const response = await fetch("/api/recognize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signatureUri: chunk.shazamSignatureUri,
        timestamp: Date.now(),
        sampleMs,
        device: "android",
        timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone ||
          "UTC",
      }),
    });

    if (!response.ok) {
      let body: unknown = null;

      try {
        body = await response.json();
      } catch {
        body = await response.text();
      }

      throw new ProxyRecognizeError(response.status, body);
    }

    const payload = (await response.json()) as ShazamTrackResponse;

    if (!payload.track?.title || !payload.track.subtitle) {
      return null;
    }

    const matches = payload.matches ?? [];
    const primary = matches[0];
    const timeSkew = Math.abs(primary?.timeskew ?? 0);
    const frequencySkew = Math.abs(primary?.frequencyskew ?? 0);
    const matchBoost = Math.min(0.2, matches.length * 0.08);
    const skewPenalty = Math.min(0.22, timeSkew * 1200 + frequencySkew * 260);
    const confidence = Number(
      Math.max(0.35, Math.min(0.96, 0.45 + 0.18 + matchBoost - skewPenalty)).toFixed(2),
    );

    return {
      title: payload.track.title,
      artist: payload.track.subtitle,
      album: inferAlbum(payload.track),
      confidence,
      rawResponse: `Shazam track key: ${payload.track.key ?? "unknown"}; matches=${matches.length}; timeskew=${timeSkew.toFixed(6)}; frequencyskew=${frequencySkew.toFixed(6)}`,
    };
  }
}
