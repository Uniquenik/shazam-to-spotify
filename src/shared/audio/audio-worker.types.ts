import { JobStage } from "../../entities/job/model/types";
import { TrackMatch } from "../../entities/track-match/model/types";

export type WorkerProgressMessage = {
  type: "progress";
  payload: {
    progress: number;
    stage: JobStage;
    processedWindows: number;
    totalWindows: number;
    partialMatches: TrackMatch[];
    warnings: string[];
  };
};

export type WorkerSuccessMessage = {
  type: "done";
  payload: {
    durationSec: number;
    matches: TrackMatch[];
    warnings: string[];
  };
};

export type WorkerFailureMessage = {
  type: "error";
  payload: {
    error: string;
  };
};

export type WorkerOutgoingMessage =
  | WorkerProgressMessage
  | WorkerSuccessMessage
  | WorkerFailureMessage;

export type WorkerIncomingMessage = {
  type: "start";
  payload: {
    audioBuffer: Float32Array;
    sampleRate: number;
    sourceName: string;
    providerId: string;
  };
};
