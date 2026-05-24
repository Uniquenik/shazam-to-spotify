export type TrackMatch = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  startedAtSec: number;
  endedAtSec?: number;
  confidence: number;
  detectionCount: number;
  provider: string;
  needsReview: boolean;
  notes?: string;
};

export type ExportRow = {
  title: string;
  artist: string;
  startTime: string;
  endTime: string;
  confidence: string;
  reviewFlag: string;
  sourceName: string;
};
