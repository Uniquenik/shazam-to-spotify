import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { Button } from "../../../shared/ui/button";
import { Card } from "../../../shared/ui/card";
import { Input } from "../../../shared/ui/input";
import { isLikelyDirectAudioUrl } from "../../../shared/lib/direct-audio-url";
import { useProcessingStore } from "../model/use-processing-store";

type SourceMode = "file" | "direct-url";

export function SourceForm() {
  const start = useProcessingStore((state) => state.start);
  const job = useProcessingStore((state) => state.job);
  const [sourceMode, setSourceMode] = useState<SourceMode>("file");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [directUrl, setDirectUrl] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const isBusy = job?.status === "preparing" || job?.status === "processing";

  const urlHint = useMemo(() => {
    if (!directUrl) {
      return "Укажите прямую ссылку на файл .mp3, .wav, .m4a и т.д.";
    }

    return isLikelyDirectAudioUrl(directUrl)
      ? "Ссылка похожа на direct audio URL."
      : "Похоже, это не прямая ссылка на аудиофайл.";
  }, [directUrl]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    if (sourceMode === "file") {
      if (!selectedFile) {
        setLocalError("Выберите аудиофайл для обработки.");
        return;
      }

      await start({ type: "file", file: selectedFile });
      return;
    }

    if (!directUrl.trim()) {
      setLocalError("Введите direct audio URL.");
      return;
    }

    await start({ type: "direct-url", url: directUrl.trim() });
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(event.target.files?.[0] ?? null);
  };

  return (
    <Card className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.24em] text-ink/45">Source</p>
        <h2 className="text-2xl font-semibold text-ink">
          Загрузите файл или укажите прямую ссылку на аудио
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-ink/65">
          MVP работает полностью в браузере. Для URL поддерживаются только
          direct audio URL, которые браузер может скачать напрямую.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          className="min-w-36"
          onClick={() => setSourceMode("file")}
          variant={sourceMode === "file" ? "primary" : "secondary"}
        >
          Local File
        </Button>
        <Button
          className="min-w-36"
          onClick={() => setSourceMode("direct-url")}
          variant={sourceMode === "direct-url" ? "primary" : "secondary"}
        >
          Direct URL
        </Button>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        {sourceMode === "file" ? (
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-ink/70">
              Аудиофайл
            </span>
            <Input
              accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
              disabled={isBusy}
              onChange={handleFileChange}
              type="file"
            />
          </label>
        ) : (
          <label className="block space-y-2">
            <span className="block text-sm font-medium text-ink/70">
              Direct audio URL
            </span>
            <Input
              disabled={isBusy}
              onChange={(event) => setDirectUrl(event.target.value)}
              placeholder="https://example.com/audio/sample.mp3"
              type="url"
              value={directUrl}
            />
            <p className="text-xs text-ink/50">{urlHint}</p>
          </label>
        )}

        {localError ? (
          <p className="rounded-3xl bg-ember/10 px-4 py-3 text-sm text-ember">
            {localError}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button disabled={isBusy} type="submit">
            {isBusy ? "Обработка..." : "Начать обработку"}
          </Button>
          <p className="max-w-xl text-sm leading-6 text-ink/50">
            Для файлов около часа держите вкладку открытой. Если браузер
            поддерживает Wake Lock, приложение попросит не усыплять устройство.
          </p>
        </div>
      </form>
    </Card>
  );
}
