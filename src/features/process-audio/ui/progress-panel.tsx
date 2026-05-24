import { useProcessingStore } from "../model/use-processing-store";
import { Badge } from "../../../shared/ui/badge";
import { Button } from "../../../shared/ui/button";
import { Card } from "../../../shared/ui/card";
import { formatSeconds } from "../../../shared/lib/time";
import { Progress } from "../../../shared/ui/progress";

const STAGE_LABELS: Record<string, string> = {
  idle: "Waiting",
  validating: "Validating source",
  "fetching-source": "Downloading source",
  "decoding-audio": "Decoding audio",
  segmenting: "Segmenting windows",
  recognizing: "Recognizing",
  aggregating: "Aggregating results",
  "export-ready": "Export ready",
  failed: "Error",
};

export function ProgressPanel() {
  const job = useProcessingStore((state) => state.job);
  const warnings = useProcessingStore((state) => state.warnings);
  const wakeLockSupported = useProcessingStore((state) => state.wakeLockSupported);
  const wakeLockActive = useProcessingStore((state) => state.wakeLockActive);
  const sourceSummary = useProcessingStore((state) => state.sourceSummary);
  const processedWindows = useProcessingStore((state) => state.processedWindows);
  const totalWindows = useProcessingStore((state) => state.totalWindows);
  const cancel = useProcessingStore((state) => state.cancel);

  if (!job) {
    return null;
  }

  const isBusy = job.status === "preparing" || job.status === "processing";

  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge>{job.status}</Badge>
            <Badge className="bg-teal/10 text-teal">{STAGE_LABELS[job.stage] ?? job.stage}</Badge>
            {wakeLockActive ? <Badge className="bg-moss/15 text-moss">Wake Lock active</Badge> : null}
          </div>
          <h3 className="text-xl font-semibold text-ink">{job.sourceName}</h3>
          <p className="text-sm text-ink/60">{sourceSummary ?? "Preparing source..."}</p>
        </div>
        {isBusy ? (
          <Button onClick={() => void cancel()} variant="danger">
            Cancel
          </Button>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm text-ink/60">
          <span>Processing progress</span>
          <span>{job.progress}%</span>
        </div>
        <Progress value={job.progress} />
        {totalWindows > 0 ? (
          <p className="text-xs text-ink/55">
            Chunks: {processedWindows}/{totalWindows} · remaining {Math.max(0, totalWindows - processedWindows)}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 text-sm text-ink/65 md:grid-cols-3">
        <div className="rounded-3xl bg-sand/80 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-ink/40">Duration</p>
          <p className="mt-1 text-lg font-semibold text-ink">
            {job.durationSec ? formatSeconds(job.durationSec) : "Pending"}
          </p>
        </div>
        <div className="rounded-3xl bg-sand/80 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-ink/40">Wake Lock</p>
          <p className="mt-1 text-lg font-semibold text-ink">
            {wakeLockActive ? "Active" : wakeLockSupported ? "Inactive" : "Not supported"}
          </p>
        </div>
        <div className="rounded-3xl bg-sand/80 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-ink/40">Notes</p>
          <p className="mt-1 text-sm leading-6 text-ink/65">
            {job.error
              ? job.error
              : isBusy
                ? "Keep this tab open while processing is running."
                : "You can review tracks and export report."}
          </p>
        </div>
      </div>

      {!wakeLockSupported ? (
        <p className="rounded-3xl bg-apricot/20 px-4 py-3 text-sm text-ink/70">
          Wake Lock API is not supported by this browser. Keep the tab active during processing.
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <div className="rounded-3xl bg-apricot/15 px-4 py-3 text-sm text-ink/70">
          <p className="font-semibold text-ink">Warnings</p>
          <ul className="mt-2 space-y-1">
            {warnings.map((warning) => (
              <li key={warning}>• {warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
