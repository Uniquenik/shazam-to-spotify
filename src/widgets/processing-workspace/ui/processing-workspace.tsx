import { ExportActions } from "../../../features/export-results/ui/export-actions";
import { ResultsTable } from "../../../features/preview-results/ui/results-table";
import { useProcessingStore } from "../../../features/process-audio/model/use-processing-store";
import { ProgressPanel } from "../../../features/process-audio/ui/progress-panel";
import { SourceForm } from "../../../features/process-audio/ui/source-form";
import { SpotifySync } from "../../../features/spotify-sync/ui/spotify-sync";
import { Button } from "../../../shared/ui/button";
import { Card } from "../../../shared/ui/card";

export function ProcessingWorkspace() {
  const reset = useProcessingStore((state) => state.reset);
  const job = useProcessingStore((state) => state.job);

  return (
    <div className="space-y-6">
      <SourceForm />
      <ProgressPanel />
      <ResultsTable />
      <ExportActions />
      <SpotifySync />

      {job ? (
        <Card className="flex flex-wrap items-center justify-between gap-4 bg-ink text-sand">
          <div>
            <p className="text-lg font-semibold">Local session state</p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-sand/70">
              Processing is executed fully on the client. After completion you can reset this session
              and start a new recognition run.
            </p>
          </div>
          <Button onClick={reset} variant="secondary">
            Reset session
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
