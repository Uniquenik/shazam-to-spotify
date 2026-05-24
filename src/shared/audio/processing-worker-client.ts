import { JobStage } from "../../entities/job/model/types";
import { TrackMatch } from "../../entities/track-match/model/types";
import { WorkerIncomingMessage, WorkerOutgoingMessage } from "./audio-worker.types";

type ProgressHandler = (event: {
  progress: number;
  stage: JobStage;
  processedWindows: number;
  totalWindows: number;
  partialMatches: TrackMatch[];
  warnings: string[];
}) => void;

export class ProcessingWorkerClient {
  private worker: Worker | null = null;

  start(
    payload: WorkerIncomingMessage["payload"],
    onProgress: ProgressHandler,
  ): Promise<{ durationSec: number; matches: TrackMatch[]; warnings: string[] }> {
    const worker = new Worker(new URL("./audio-worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker = worker;

    return new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<WorkerOutgoingMessage>) => {
        if (event.data.type === "progress") {
          onProgress(event.data.payload);
          return;
        }

        if (event.data.type === "done") {
          resolve(event.data.payload);
          worker.terminate();
          this.worker = null;
          return;
        }

        reject(new Error(event.data.payload.error));
        worker.terminate();
        this.worker = null;
      };

      worker.onerror = () => {
        reject(new Error("Worker завершился с ошибкой."));
        worker.terminate();
        this.worker = null;
      };

      worker.postMessage({
        type: "start",
        payload,
      } satisfies WorkerIncomingMessage);
    });
  }

  cancel() {
    this.worker?.terminate();
    this.worker = null;
  }
}
