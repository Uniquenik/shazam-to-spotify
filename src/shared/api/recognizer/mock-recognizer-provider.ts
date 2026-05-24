import {
  RecognitionCandidate,
  RecognitionChunk,
  RecognizerProvider,
} from "./types";

const TITLES = [
  "Night Drive",
  "Signal Bloom",
  "Velvet Frequency",
  "Amber Echo",
  "Skyline Loop",
  "Northern Tape",
];

const ARTISTS = [
  "Demo Atlas",
  "Static Seasons",
  "Pilot Hearts",
  "Late FM",
  "Transit Color",
];

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

export class MockRecognizerProvider implements RecognizerProvider {
  readonly id = "mock-recognizer";

  async recognize(chunk: RecognitionChunk): Promise<RecognitionCandidate | null> {
    if (
      chunk.energyScore < 0.018 ||
      chunk.fingerprintHashes < 14 ||
      chunk.fingerprintQuality < 0.22
    ) {
      return null;
    }

    const seed = hashString(
      [
        chunk.sourceFingerprint,
        Math.floor(chunk.startSec / 3),
        chunk.index,
        chunk.fingerprintHashes,
        chunk.landmarkPeaks,
      ].join(":"),
    );
    const fingerprintBoost = Math.min(0.24, chunk.fingerprintQuality * 0.3);
    const baseConfidence = 0.54 + ((seed % 22) / 100) + fingerprintBoost;

    if (seed % 11 === 0) {
      return null;
    }

    return {
      title: TITLES[seed % TITLES.length],
      artist: ARTISTS[(seed >> 3) % ARTISTS.length],
      album: "MVP Browser Sessions",
      confidence: Number(Math.min(baseConfidence, 0.92).toFixed(2)),
      rawResponse:
        `Mock recognizer via Shazam-like fingerprint (${chunk.fingerprintHashes} hashes, ${chunk.landmarkPeaks} peaks).`,
    };
  }
}
