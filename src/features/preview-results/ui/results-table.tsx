import { useProcessingStore } from "../../process-audio/model/use-processing-store";
import { formatSeconds } from "../../../shared/lib/time";
import { Badge } from "../../../shared/ui/badge";
import { Card } from "../../../shared/ui/card";

export function ResultsTable() {
  const results = useProcessingStore((state) => state.results);
  const job = useProcessingStore((state) => state.job);

  return (
    <Card className="space-y-5">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.24em] text-ink/45">Preview</p>
        <h3 className="text-xl font-semibold text-ink">
          Предварительный список найденных треков
        </h3>
        <p className="text-sm leading-6 text-ink/65">
          Таблица обновляется по мере обработки. Для спорных совпадений ставится
          флаг review.
        </p>
      </div>

      {results.length === 0 ? (
        <div className="rounded-4xl border border-dashed border-ink/15 px-6 py-10 text-center text-sm text-ink/55">
          {job?.status === "processing"
            ? "Результаты появятся по мере обработки."
            : "Пока нет распознанных треков."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-2 text-left">
            <thead>
              <tr className="text-xs uppercase tracking-[0.16em] text-ink/40">
                <th className="px-4 py-2">Track</th>
                <th className="px-4 py-2">Artist</th>
                <th className="px-4 py-2">Range</th>
                <th className="px-4 py-2">Confidence</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {results.map((track) => (
                <tr key={track.id} className="rounded-3xl bg-sand/70">
                  <td className="rounded-l-3xl px-4 py-3">
                    <div className="font-semibold text-ink">{track.title}</div>
                    <div className="text-xs text-ink/45">
                      {track.album ?? "Unknown album"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink/70">{track.artist}</td>
                  <td className="px-4 py-3 text-sm text-ink/70">
                    {formatSeconds(track.startedAtSec)} -{" "}
                    {formatSeconds(track.endedAtSec ?? track.startedAtSec)}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink/70">
                    {Math.round(track.confidence * 100)}%
                  </td>
                  <td className="rounded-r-3xl px-4 py-3">
                    <Badge
                      className={
                        track.needsReview
                          ? "bg-apricot/25 text-ember"
                          : "bg-moss/15 text-moss"
                      }
                    >
                      {track.needsReview ? "Needs review" : "OK"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
