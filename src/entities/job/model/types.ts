export type JobStatus =
  | "idle"
  | "preparing"
  | "processing"
  | "done"
  | "partial"
  | "failed"
  | "cancelled";

export type JobStage =
  | "idle"
  | "validating"
  | "fetching-source"
  | "decoding-audio"
  | "segmenting"
  | "recognizing"
  | "aggregating"
  | "export-ready"
  | "failed";

export type Job = {
  id: string;
  sourceType: "file" | "direct-url";
  sourceName: string;
  durationSec: number;
  status: JobStatus;
  stage: JobStage;
  progress: number;
  createdAt: string;
  error?: string;
  warnings: string[];
};
