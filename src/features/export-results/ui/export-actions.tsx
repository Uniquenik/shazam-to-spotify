import { useMemo } from "react";
import { useProcessingStore } from "../../process-audio/model/use-processing-store";
import { downloadCsv } from "../../../shared/lib/csv";
import { formatSeconds } from "../../../shared/lib/time";
import { downloadXlsx } from "../../../shared/lib/xlsx";
import { Button } from "../../../shared/ui/button";
import { Card } from "../../../shared/ui/card";

export function ExportActions() {
  const results = useProcessingStore((state) => state.results);
  const job = useProcessingStore((state) => state.job);

  const rows = useMemo(
    () =>
      results.map((track) => ({
        title: track.title,
        artist: track.artist,
        startTime: formatSeconds(track.startedAtSec),
        endTime: formatSeconds(track.endedAtSec ?? track.startedAtSec),
        confidence: `${Math.round(track.confidence * 100)}%`,
        reviewFlag: track.needsReview ? "Needs review" : "OK",
        sourceName: job?.sourceName ?? "Unknown source",
      })),
    [job?.sourceName, results],
  );

  const disabled = rows.length === 0;

  return (
    <Card className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.24em] text-ink/45">Export</p>
        <h3 className="text-xl font-semibold text-ink">Скачивание результата</h3>
        <p className="text-sm leading-6 text-ink/65">
          Сначала проверьте список найденных треков, затем скачайте отчет в
          удобном формате.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          disabled={disabled}
          onClick={() => downloadCsv("recognized-tracks.csv", rows)}
          variant="primary"
        >
          Скачать CSV
        </Button>
        <Button
          disabled={disabled}
          onClick={() => void downloadXlsx("recognized-tracks.xlsx", rows)}
          variant="secondary"
        >
          Скачать XLSX
        </Button>
      </div>
    </Card>
  );
}
