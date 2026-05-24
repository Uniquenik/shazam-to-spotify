export type RecognitionWindow = {
  index: number;
  startSec: number;
  endSec: number;
  energyScore: number;
  matched: boolean;
  rawResponse?: string;
};
