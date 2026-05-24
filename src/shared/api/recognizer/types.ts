export type RecognitionChunk = {
  index: number;
  startSec: number;
  endSec: number;
  energyScore: number;
  sourceName: string;
  sourceFingerprint: string;
  shazamSignatureUri?: string;
  shazamSampleMs?: number;
  fingerprintHashes: number;
  landmarkPeaks: number;
  fingerprintQuality: number;
};

export type RecognitionCandidate = {
  title: string;
  artist: string;
  album?: string;
  confidence: number;
  rawResponse?: string;
};

export interface RecognizerProvider {
  readonly id: string;
  recognize(chunk: RecognitionChunk): Promise<RecognitionCandidate | null>;
}
