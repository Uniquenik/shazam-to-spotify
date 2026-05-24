# Описание от человека

Веб-приложение, которое позволяет шазамить большие аудиозаписи по частям с эвристикой по оптимизации запросов, группировке и фильтрации результатов

Результаты можно экспортировать в файл или же добавить в spotify - добавлены проверки на дубли и поиск наиболее подходящих треков если не найдено совпадение по названию

ПО максимуму все делается на клиенте, сервер проксирует запросы и общается со spotify

Робот, актуализируй доку ниже плиз

# Audio Track Recognizer SPA

SPA-only MVP для распознавания треков из локального аудиофайла или direct audio URL.

## Что уже реализовано

- `React + TypeScript + Vite + Tailwind CSS`
- FSD-подобная структура `app/pages/widgets/features/entities/shared`
- браузерный `ProcessingEngine`
- `Wake Lock` во время обработки
- поддержка `local file` и `direct audio URL`
- предпросмотр списка треков до скачивания
- экспорт в `CSV/XLSX`
- worker-обработка с прогрессом и отменой

## Важное ограничение MVP

Реальный браузерный Shazam-compatible распознаватель не включен. В текущей реализации используется `MockRecognizerProvider`, чтобы:

- проверить UX, пайплайн и структуру приложения;
- оставить стабильный контракт `RecognizerProvider`;
- безболезненно заменить провайдер на реальный браузерный адаптер или будущий backend adapter.

## Структура

- `src/app` — провайдеры, глобальные стили, корневой app
- `src/pages` — экран приложения
- `src/widgets` — компоновка экранных блоков
- `src/features` — пользовательские сценарии: запуск, прогресс, экспорт, предпросмотр
- `src/entities` — доменные типы задач, источников и результатов
- `src/shared` — UI, audio engine, worker bridge, recognizer contracts, утилиты

## Как запустить

```bash
npm install
npm run dev
```

## Что подключать дальше

1. Реальный `RecognizerProvider` вместо `MockRecognizerProvider`.
2. Нормализацию через `ffmpeg.wasm`, если понадобится более строгая подготовка форматов.
3. `RemoteProcessingEngine` и backend/proxy для URL без CORS и для long-running задач.

## Shazam-style backend proxy

The app now supports a backend flow compatible with the common `shazamio` pattern:

1. Frontend calls `POST /api/recognize`
2. Proxy forwards to `POST https://amp.shazam.com/discovery/v5/{lang}/{country}/android/-/tag/{uuid1}/{uuid2}`
3. Track details can be requested via `GET /api/track/:id`, proxied to `/discovery/v5/.../track/{id}`

Run in two terminals:

```bash
npm run dev:proxy
npm run dev
```

Optional env vars for proxy:

- `SHAZAM_PROXY_PORT` (default `8787`)
- `SHAZAM_LANG` (default `en`)
- `SHAZAM_COUNTRY` (default `US`)
- `VITE_RECOGNIZER_PROXY_TARGET` (default `http://localhost:8787`)

Note: a true Shazam recognition requires a valid Shazam signature payload (`data:audio/vnd.shazam.sig;base64,...`).
Current frontend generates a lightweight placeholder signature from browser fingerprint data, so worker keeps a mock fallback for stable UX.
