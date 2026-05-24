import { JobStage } from "../../entities/job/model/types";
import { RecognitionWindow } from "../../entities/recognition-window/model/types";
import { PreparedSource, SourceInput } from "../../entities/source/model/types";
import { TrackMatch } from "../../entities/track-match/model/types";
import { ProcessingWorkerClient } from "./processing-worker-client";
import { resolveSource, SourceDownloadProgress } from "./source-resolver";

export type EngineProgress = {
  progress: number;
  stage: JobStage;
  processedWindows: number;
  totalWindows: number;
  partialMatches: TrackMatch[];
  warnings: string[];
};

export interface ProcessingEngine {
  prepare(
    source: SourceInput,
    onPrepareProgress?: (payload: SourceDownloadProgress) => void,
  ): Promise<{ preparedSource: PreparedSource; durationSec: number }>;
  run(onProgress: (payload: EngineProgress) => void): Promise<{
    matches: TrackMatch[];
    windows: RecognitionWindow[];
    warnings: string[];
  }>;
  cancel(): void;
  getResults(): TrackMatch[];
}

function audioBufferToMonoFloat32(buffer: AudioBuffer) {
  const channelData = buffer.getChannelData(0);
  return new Float32Array(channelData);
}

export class BrowserProcessingEngine implements ProcessingEngine {
  private preparedSource: PreparedSource | null = null;
  private decodedBuffer: AudioBuffer | null = null;
  private results: TrackMatch[] = [];
  private workerClient: ProcessingWorkerClient | null = null;

  async prepare(source: SourceInput, onPrepareProgress?: (payload: SourceDownloadProgress) => void) {
    this.preparedSource = await resolveSource(source, onPrepareProgress);
    const arrayBuffer = await this.preparedSource.blob.arrayBuffer();
    const audioContext = new AudioContext();

    try {
      this.decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    } catch {
      throw new Error("Не удалось декодировать аудио. Проверьте формат файла.");
    } finally {
      await audioContext.close();
    }

    if (this.decodedBuffer.duration > 60 * 60 * 1.5) {
      throw new Error("Для MVP поддерживаются записи примерно до 1-1.5 часа.");
    }

    return {
      preparedSource: this.preparedSource,
      durationSec: this.decodedBuffer.duration,
    };
  }

  async run(onProgress: (payload: EngineProgress) => void) {
    if (!this.preparedSource || !this.decodedBuffer) {
      throw new Error("Источник не подготовлен.");
    }

    const monoBuffer = audioBufferToMonoFloat32(this.decodedBuffer);
    const workerClient = new ProcessingWorkerClient();
    this.workerClient = workerClient;

    const response = await workerClient.start(
      {
        audioBuffer: monoBuffer,
        sampleRate: this.decodedBuffer.sampleRate,
        sourceName: this.preparedSource.sourceName,
        providerId: "shazam-proxy",
      },
      onProgress,
    );

    this.results = response.matches;

    const windows: RecognitionWindow[] = response.matches.map((match, index) => ({
      index,
      startSec: match.startedAtSec,
      endSec: match.endedAtSec ?? match.startedAtSec + 15,
      energyScore: Number(match.confidence.toFixed(2)),
      matched: true,
      rawResponse: match.notes,
    }));

    return {
      matches: response.matches,
      windows,
      warnings: response.warnings,
    };
  }

  cancel() {
    this.workerClient?.cancel();
  }

  getResults() {
    return this.results;
  }
}
