import { TrackMatch } from "../../entities/track-match/model/types";
import {
  ProxyRecognizeError,
  ShazamProxyRecognizerProvider,
} from "../api/recognizer/shazam-proxy-recognizer-provider";
import { WorkerIncomingMessage, WorkerOutgoingMessage } from "./audio-worker.types";
import initShazamio, { DecodedSignature } from "shazamio-core/web";
import shazamWasmUrl from "shazamio-core/web/shazamio-core_bg.wasm?url";

const WINDOW_SECONDS = 12;
const GAP_SECONDS = 10;
const STEP_SECONDS = WINDOW_SECONDS + GAP_SECONDS;
const SILENCE_FLOOR = 0.003;
const REQUEST_DELAY_MS = 1600;
const RATE_LIMIT_BACKOFF_MS = 6000;

type CandidateWindow = {
  index: number;
  start: number;
  end: number;
  startSec: number;
  endSec: number;
  energyScore: number;
};

const proxyProvider = new ShazamProxyRecognizerProvider();
let shazamInitPromise: Promise<unknown> | null = null;

function computeRms(chunk: Float32Array) {
  let sum = 0;

  for (let index = 0; index < chunk.length; index += 1) {
    sum += chunk[index] * chunk[index];
  }

  return Math.sqrt(sum / chunk.length || 0);
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function ensureShazamReady() {
  if (!shazamInitPromise) {
    shazamInitPromise = initShazamio(shazamWasmUrl);
  }

  await shazamInitPromise;
}

function buildCandidateWindows(audioBuffer: Float32Array, sampleRate: number) {
  const windowSize = Math.floor(sampleRate * WINDOW_SECONDS);
  const stepSize = Math.floor(sampleRate * STEP_SECONDS);

  if (windowSize <= 0 || stepSize <= 0) {
    return [] as CandidateWindow[];
  }

  const totalWindows = Math.max(1, Math.ceil((audioBuffer.length - windowSize) / stepSize) + 1);
  const windows: CandidateWindow[] = [];

  for (let index = 0; index < totalWindows; index += 1) {
    const start = index * stepSize;
    const end = Math.min(audioBuffer.length, start + windowSize);
    const chunk = audioBuffer.slice(start, end);

    windows.push({
      index,
      start,
      end,
      startSec: start / sampleRate,
      endSec: end / sampleRate,
      energyScore: computeRms(chunk),
    });
  }

  return windows;
}

function pickRecognitionWindows(windows: CandidateWindow[]) {
  return windows
    .filter((window) => window.energyScore >= SILENCE_FLOOR)
    .sort((left, right) => left.startSec - right.startSec);
}

function overlaps(left: TrackMatch, right: TrackMatch) {
  const leftEnd = left.endedAtSec ?? left.startedAtSec;
  const rightEnd = right.endedAtSec ?? right.startedAtSec;

  return left.startedAtSec <= rightEnd && right.startedAtSec <= leftEnd;
}

function overlapDuration(left: TrackMatch, right: TrackMatch) {
  const leftEnd = left.endedAtSec ?? left.startedAtSec;
  const rightEnd = right.endedAtSec ?? right.startedAtSec;
  const start = Math.max(left.startedAtSec, right.startedAtSec);
  const end = Math.min(leftEnd, rightEnd);
  return Math.max(0, end - start);
}

function trackSpanSec(track: TrackMatch) {
  const end = track.endedAtSec ?? track.startedAtSec;
  return Math.max(0.001, end - track.startedAtSec);
}

function enrichConfidence(match: TrackMatch) {
  if (match.provider === "unknown") {
    return match;
  }

  const end = match.endedAtSec ?? match.startedAtSec;
  const spanSec = Math.max(0, end - match.startedAtSec);
  const supportBoost = Math.min(0.22, 0.06 * Math.log2(1 + match.detectionCount));
  const spanBoost = Math.min(0.16, spanSec / 900);
  const base = Math.max(0.42, match.confidence * 0.6 + 0.2);
  const confidence = Number(Math.min(0.97, base + supportBoost + spanBoost).toFixed(2));

  return {
    ...match,
    confidence,
    needsReview: confidence < 0.72 || match.detectionCount < 2,
  };
}

function aggregateMatches(matches: TrackMatch[]) {
  const sorted = [...matches].sort((left, right) => left.startedAtSec - right.startedAtSec);
  const knownBySong = new Map<string, TrackMatch>();
  const unknownSegments: TrackMatch[] = [];

  for (const match of sorted) {
    const isUnknown = match.provider === "unknown" || match.title.toLowerCase() === "unknown track";

    if (isUnknown) {
      const lastUnknown = unknownSegments[unknownSegments.length - 1];

      if (
        lastUnknown &&
        Math.abs((lastUnknown.endedAtSec ?? lastUnknown.startedAtSec) - match.startedAtSec) <= STEP_SECONDS + 2
      ) {
        lastUnknown.endedAtSec = Math.max(
          lastUnknown.endedAtSec ?? lastUnknown.startedAtSec,
          match.endedAtSec ?? match.startedAtSec,
        );
        lastUnknown.detectionCount += match.detectionCount;
        continue;
      }

      unknownSegments.push({ ...match });
      continue;
    }

    const key = `${match.title.trim().toLowerCase()}::${match.artist.trim().toLowerCase()}`;
    const existing = knownBySong.get(key);

    if (existing) {
      const existingEnd = existing.endedAtSec ?? existing.startedAtSec;
      const nextEnd = match.endedAtSec ?? match.startedAtSec;
      const totalDetections = existing.detectionCount + match.detectionCount;

      existing.startedAtSec = Math.min(existing.startedAtSec, match.startedAtSec);
      existing.endedAtSec = Math.max(existingEnd, nextEnd);
      existing.confidence = Number(
        (
          (existing.confidence * existing.detectionCount + match.confidence * match.detectionCount) /
          Math.max(1, totalDetections)
        ).toFixed(2),
      );
      existing.detectionCount = totalDetections;
      existing.needsReview = existing.needsReview || match.needsReview;
      continue;
    }

    knownBySong.set(key, { ...match });
  }

  let known = [...knownBySong.values()].map(enrichConfidence);

  known = known.filter((candidate) => {
    if (candidate.detectionCount > 1) {
      return true;
    }

    return !known.some(
      (dominant) =>
        dominant.id !== candidate.id &&
        dominant.detectionCount >= 2 &&
        dominant.confidence >= candidate.confidence &&
        overlaps(candidate, dominant),
    );
  });

  const sortedByStrength = [...known].sort((left, right) => {
    const leftScore = left.confidence * (1 + Math.log2(1 + left.detectionCount));
    const rightScore = right.confidence * (1 + Math.log2(1 + right.detectionCount));
    return rightScore - leftScore;
  });
  const accepted: TrackMatch[] = [];

  for (const candidate of sortedByStrength) {
    const isConflict = accepted.some((winner) => {
      if (
        winner.title.trim().toLowerCase() === candidate.title.trim().toLowerCase() &&
        winner.artist.trim().toLowerCase() === candidate.artist.trim().toLowerCase()
      ) {
        return false;
      }

      const overlapSec = overlapDuration(winner, candidate);
      if (overlapSec <= 0) {
        return false;
      }

      const candidateCover = overlapSec / trackSpanSec(candidate);
      const winnerCover = overlapSec / trackSpanSec(winner);

      return candidateCover >= 0.75 || winnerCover >= 0.75;
    });

    if (!isConflict) {
      accepted.push(candidate);
    }
  }

  known = accepted.sort((left, right) => left.startedAtSec - right.startedAtSec);

  const unknown = unknownSegments.map((segment) => {
    const confidence = Number(Math.min(0.6, 0.32 + segment.detectionCount * 0.03).toFixed(2));

    return {
      ...segment,
      confidence,
      needsReview: true,
    };
  });

  return [...known, ...unknown].sort((left, right) => left.startedAtSec - right.startedAtSec);
}

self.onmessage = async (event: MessageEvent<WorkerIncomingMessage>) => {
  if (event.data.type !== "start") {
    return;
  }

  try {
    const { audioBuffer, sampleRate, sourceName } = event.data.payload;
    const allWindows = buildCandidateWindows(audioBuffer, sampleRate);
    const selectedWindows = pickRecognitionWindows(allWindows);
    const rawMatches: TrackMatch[] = [];
    const warnings: string[] = [
      "Signature generation uses shazamio-core (WASM) in browser worker.",
      "Shazam matching window length is capped at 12 seconds per request.",
      `Recognition windows queued: ${selectedWindows.length} of ${allWindows.length}.`,
      `Request spacing: ${STEP_SECONDS}s step (${WINDOW_SECONDS}s window + ${GAP_SECONDS}s gap), ${REQUEST_DELAY_MS}ms between requests.`,
    ];

    if (selectedWindows.length === 0) {
      warnings.push("No energetic windows found for Shazam recognition.");
    }

    await ensureShazamReady();

    let failureStreak = 0;
    let failureStartSec: number | null = null;
    let failureEndSec: number | null = null;

    const flushUnknownStreak = () => {
      if (failureStreak >= 2 && failureStartSec !== null && failureEndSec !== null) {
        rawMatches.push({
          id: `unknown-${failureStartSec.toFixed(2)}-${failureEndSec.toFixed(2)}`,
          title: "Unknown track",
          artist: "Unknown",
          startedAtSec: failureStartSec,
          endedAtSec: failureEndSec,
          confidence: 0.35,
          detectionCount: failureStreak,
          provider: "unknown",
          needsReview: true,
          notes: `No confident Shazam match in ${failureStreak} consecutive segments.`,
        });
      }

      failureStreak = 0;
      failureStartSec = null;
      failureEndSec = null;
    };

    for (let index = 0; index < selectedWindows.length; index += 1) {
      const window = selectedWindows[index];
      const chunk = audioBuffer.slice(window.start, window.end);

      let signature: DecodedSignature | null = null;

      try {
        signature = DecodedSignature.new(chunk, sampleRate, 1);

        const candidate = await proxyProvider.recognize({
          index: window.index,
          startSec: window.startSec,
          endSec: window.endSec,
          energyScore: window.energyScore,
          sourceName,
          sourceFingerprint: "",
          shazamSignatureUri: signature.uri,
          shazamSampleMs: signature.samplems,
          fingerprintHashes: 0,
          landmarkPeaks: 0,
          fingerprintQuality: 0,
        });

        if (candidate) {
          flushUnknownStreak();

          rawMatches.push({
            id: `${candidate.title}-${candidate.artist}-${window.index}`,
            title: candidate.title,
            artist: candidate.artist,
            album: candidate.album,
            startedAtSec: window.startSec,
            endedAtSec: window.endSec,
            confidence: candidate.confidence,
            detectionCount: 1,
            provider: proxyProvider.id,
            needsReview: candidate.confidence < 0.7,
            notes: candidate.rawResponse,
          });
        } else {
          failureStreak += 1;
          failureStartSec ??= window.startSec;
          failureEndSec = window.endSec;
        }
      } catch (error) {
        if (error instanceof ProxyRecognizeError && error.status === 429) {
          warnings.push(
            `Shazam returned 429 at window ${window.index}. Applying ${RATE_LIMIT_BACKOFF_MS}ms backoff and continuing.`,
          );
          await sleep(RATE_LIMIT_BACKOFF_MS);
        } else {
          const message = error instanceof Error ? error.message : "Unknown recognize error";
          warnings.push(`Recognition window ${window.index} failed: ${message}`);

          failureStreak += 1;
          failureStartSec ??= window.startSec;
          failureEndSec = window.endSec;
        }
      } finally {
        signature?.free();
      }

      if (index < selectedWindows.length - 1) {
        await sleep(REQUEST_DELAY_MS);
      }

      self.postMessage({
        type: "progress",
        payload: {
          progress: Math.round(((index + 1) / Math.max(1, selectedWindows.length)) * 100),
          stage: index === selectedWindows.length - 1 ? "aggregating" : "recognizing",
          processedWindows: index + 1,
          totalWindows: selectedWindows.length,
          partialMatches: aggregateMatches(rawMatches),
          warnings,
        },
      } satisfies WorkerOutgoingMessage);
    }

    flushUnknownStreak();

    self.postMessage({
      type: "done",
      payload: {
        durationSec: audioBuffer.length / sampleRate,
        matches: aggregateMatches(rawMatches),
        warnings,
      },
    } satisfies WorkerOutgoingMessage);
  } catch (error) {
    self.postMessage({
      type: "error",
      payload: {
        error: error instanceof Error ? error.message : "Unknown worker error.",
      },
    } satisfies WorkerOutgoingMessage);
  }
};
