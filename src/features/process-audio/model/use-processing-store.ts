import { create } from "zustand";
import { Job } from "../../../entities/job/model/types";
import { SourceInput } from "../../../entities/source/model/types";
import { TrackMatch } from "../../../entities/track-match/model/types";
import { BrowserProcessingEngine } from "../../../shared/audio/browser-processing-engine";
import { releaseWakeLock, requestWakeLock } from "../../../shared/audio/wake-lock";
import { formatSeconds } from "../../../shared/lib/time";

type ProcessingState = {
  engine: BrowserProcessingEngine;
  job: Job | null;
  results: TrackMatch[];
  warnings: string[];
  processedWindows: number;
  totalWindows: number;
  wakeLockSupported: boolean;
  wakeLockActive: boolean;
  sourceSummary: string | null;
  reset: () => void;
  start: (source: SourceInput) => Promise<void>;
  cancel: () => Promise<void>;
};

const initialJob = (): Job => ({
  id: crypto.randomUUID(),
  sourceType: "file",
  sourceName: "",
  durationSec: 0,
  status: "idle",
  stage: "idle",
  progress: 0,
  createdAt: new Date().toISOString(),
  warnings: [],
});

let currentWakeLock: WakeLockSentinel | null = null;

export const useProcessingStore = create<ProcessingState>((set, get) => ({
  engine: new BrowserProcessingEngine(),
  job: null,
  results: [],
  warnings: [],
  processedWindows: 0,
  totalWindows: 0,
  wakeLockSupported: typeof navigator !== "undefined" && Boolean(navigator.wakeLock),
  wakeLockActive: false,
  sourceSummary: null,
  reset: () =>
    set({
      job: null,
      results: [],
      warnings: [],
      processedWindows: 0,
      totalWindows: 0,
      sourceSummary: null,
    }),
  start: async (source) => {
    const engine = new BrowserProcessingEngine();

    set({
      engine,
      job: {
        ...initialJob(),
        sourceType: source.type,
        sourceName: source.type === "file" ? source.file.name : source.url,
        status: "preparing",
        stage: "validating",
      },
      results: [],
      warnings: [],
      processedWindows: 0,
      totalWindows: 0,
      sourceSummary: null,
    });

    currentWakeLock = await requestWakeLock();
    set({
      wakeLockActive: Boolean(currentWakeLock),
    });

    try {
      const { preparedSource, durationSec } = await engine.prepare(source, (download) => {
        if (source.type !== "direct-url") {
          return;
        }

        const downloadedMb = (download.downloadedBytes / (1024 * 1024)).toFixed(1);
        const totalMb = download.totalBytes
          ? (download.totalBytes / (1024 * 1024)).toFixed(1)
          : null;
        const percent = download.totalBytes
          ? Math.min(100, Math.round((download.downloadedBytes / download.totalBytes) * 100))
          : null;

        set((state) => ({
          sourceSummary:
            percent !== null
              ? `Downloading audio: ${percent}% (${downloadedMb}/${totalMb} MB)`
              : `Downloading audio: ${downloadedMb} MB`,
          job: state.job
            ? {
                ...state.job,
                stage: "fetching-source",
              }
            : null,
        }));
      });

      set((state) => ({
        sourceSummary: `${preparedSource.sourceName} · ${formatSeconds(durationSec)} · ${Math.max(
          1,
          Math.round(preparedSource.bytes / (1024 * 1024)),
        )} MB`,
        job: state.job
          ? {
              ...state.job,
              sourceName: preparedSource.sourceName,
              durationSec,
              status: "processing",
              stage: "decoding-audio",
            }
          : null,
      }));

      const response = await engine.run((payload) => {
        set((state) => ({
          job: state.job
            ? {
                ...state.job,
                status: "processing",
                stage: payload.stage,
                progress: payload.progress,
                warnings: payload.warnings,
              }
            : null,
          results: payload.partialMatches,
          warnings: payload.warnings,
          processedWindows: payload.processedWindows,
          totalWindows: payload.totalWindows,
        }));
      });

      set((state) => ({
        job: state.job
          ? {
              ...state.job,
              status: response.warnings.length > 0 ? "partial" : "done",
              stage: "export-ready",
              progress: 100,
              warnings: response.warnings,
            }
          : null,
        results: response.matches,
        warnings: response.warnings,
      }));
    } catch (error) {
      set((state) => ({
        job: state.job
          ? {
              ...state.job,
              status: "failed",
              stage: "failed",
              error: error instanceof Error ? error.message : "Unknown error.",
            }
          : null,
      }));
    } finally {
      await releaseWakeLock(currentWakeLock);
      currentWakeLock = null;
      set({ wakeLockActive: false });
    }
  },
  cancel: async () => {
    get().engine.cancel();
    await releaseWakeLock(currentWakeLock);
    currentWakeLock = null;
    set((state) => ({
      wakeLockActive: false,
      processedWindows: 0,
      totalWindows: 0,
      job: state.job
        ? {
            ...state.job,
            status: "cancelled",
            stage: "failed",
            error: "Processing cancelled by user.",
          }
        : null,
    }));
  },
}));
