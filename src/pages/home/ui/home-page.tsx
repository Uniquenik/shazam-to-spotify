import { Badge } from "../../../shared/ui/badge";
import { ProcessingWorkspace } from "../../../widgets/processing-workspace/ui/processing-workspace";

export function HomePage() {
  return (
    <main className="min-h-screen bg-paper-grid bg-[size:24px_24px] px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[2.5rem] border border-white/70 bg-gradient-to-br from-white/95 via-sand to-apricot/35 p-8 shadow-panel">
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-ember/10 text-ember">SPA-only MVP</Badge>
              <Badge className="bg-teal/10 text-teal">Wake Lock</Badge>
              <Badge className="bg-moss/10 text-moss">FSD-inspired</Badge>
            </div>
            <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight text-ink sm:text-5xl">
              Browser-first сервис для распознавания треков из аудиофайлов и
              direct audio URL
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-ink/70">
              Приложение обрабатывает аудио локально в браузере, показывает
              прогресс, удерживает устройство от сна во время долгих задач и
              дает предварительный просмотр найденных треков перед экспортом.
            </p>
          </div>

          <div className="rounded-[2.5rem] border border-white/70 bg-ink p-8 text-sand shadow-panel">
            <p className="text-xs uppercase tracking-[0.24em] text-sand/45">
              MVP Boundaries
            </p>
            <ul className="mt-4 space-y-4 text-sm leading-6 text-sand/75">
              <li>Desktop-first сценарий без backend на текущем этапе.</li>
              <li>Поддерживаются local file и direct audio URL.</li>
              <li>Записи до ~1 часа являются целевым кейсом.</li>
              <li>Текущее распознавание идет через mock provider-адаптер.</li>
              <li>Архитектура готова к будущему server processing engine.</li>
            </ul>
          </div>
        </section>

        <ProcessingWorkspace />
      </div>
    </main>
  );
}
