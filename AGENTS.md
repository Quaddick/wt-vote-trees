# WT Vote Trees

Сайт с деревьями наземной техники War Thunder по нациям, где на каждой машине выставлен коэффициент или блок, — для голосовалки на стриме.

## Команды

Node 22+. Синтаксис ниже — bash; в PowerShell переменные задаются `$env:PORT=3917`.

- `npm ci` — зависимости.
- `npm run check` — `tsc --noEmit` + все тесты vitest; одна проверка перед коммитом.
- `npx vitest run <файл>` — один файл тестов.
- `npm run e2e` — Playwright (18 тестов); сам собирает `dist/` и поднимает 3 сервера на портах 4319–4321, эти порты должны быть свободны.
- `npm run build` — `dist/` (vite) и проверка типов сервера (`tsc -p tsconfig.server.json`, без вывода).
- `PORT=3917 ADMIN_PASSWORD=<пароль> npm start` — собранный сервер, данные в `data/runtime`; нужен `dist/` из `npm run build`.
- `npm run dev` — Vite вместе с API-сервером (плагин в `vite.config.ts` запускает `server/main.ts`, пишет в `data/runtime`); без API — `VITEST=1 npx vite`.
- `docker compose up -d --build` — контейнер на http://127.0.0.1:8080, данные в `./data/runtime`; `ADMIN_PASSWORD` берётся из окружения или `.env` рядом с `docker-compose.yml`.
- `npm run seed:tiles` — нарезка `images/*.png` в `data/seed/tiles/` (в git не попадает); `npm run seed` — `data/seed/values.json` и `docs/seed-report.md` из `data/seed/raw/`.
- `npm run catalog` — пересборка `public/catalog/` из вики, ходит в сеть; `-- --refresh` перекачивает страницы машин. В приёмке не запускался.

## Где что

- `shared/types.ts`, `shared/values.ts` — контракт данных и чистые функции над значениями; общие для сервера, страницы и скриптов.
- `server/` — `app.ts` (HTTP API, раздача `dist/`), `store.ts` (`values.json`, `changes.json`), `auth.ts` (сессии, лимит входа), `main.ts` (окружение, запуск).
- `src/state.ts` — всё состояние страницы и опрос сервера; `src/api.ts` — единственная сеть страницы; `src/components/` — вид зрителя; `src/editor/` — режим правки стримера.
- `public/catalog/` (`trees.json`, `slots/`, `flags/`) — каталог 1227 машин, лежит в git; собирает `scripts/catalog/`.
- `data/seed/` — стартовые значения: `raw/<нация>.json` (расшифровка скриншотов) → `values.json`; сборка в `scripts/seed/`, отчёт — `docs/seed-report.md`.
- `tests/` (server, seed, web) и рядом с кодом `*.test.ts(x)` — vitest; `e2e/` — Playwright.
- `docs/architecture.md` — поток данных, границы модулей, соглашения.
- `docs/adr/` — почему сделано так; `CONTEXT.md` — словарь (карточка, коэффициент, блок, папка-группа, стример); `docs/DEPLOY.md` — Docker, nginx, `TRUSTED_PROXIES`.

## Подводные камни

- `.env` читает только `docker compose`; `npm start` и `npm run dev` берут переменные только из окружения.
- На Windows часть портов зарезервирована системой (`listen EACCES`) — задай другой `PORT`.
- `npm run dev` сам запускает API-сервер на `PORT` (по умолчанию 8080); тот же `PORT` задаёт прокси `/api` в Vite.
- Стартовые значения копируются в `DATA_DIR` только если там ещё нет `values.json`. Если `npm run dev` или тесты уже создали в `data/runtime/` пустой `{}`, Docker с томом `./data` покажет все машины по «1». Если в файле ровно `{}`, удали его и перезапусти контейнер.
- `server/main.ts` при битом `values.json` или `changes.json` не стартует и файл не трогает; без `ADMIN_PASSWORD` сайт только на просмотр (вход отвечает 403).
- `TRUSTED_PROXIES` по умолчанию пуст: за nginx лимит неверных паролей общий на всех посетителей, пока в нём не указан адрес прокси.
- Смена `ADMIN_PASSWORD` не отзывает уже выданные сессии: токен подписан только `SESSION_SECRET`. Пустой `SESSION_SECRET` — новый секрет при каждом запуске, все входы слетают.
- Значения хранятся по ID машины вики; ID папки-группы типа `g` может совпасть с ID её первой машины — ключ в DOM только с префиксом типа (`src/components/TreeView.tsx`).
- В каталоге у 10 машин `br: null` (показывать «—»), у 3 машин `*_yt_cup_2019` `hasSlot: false` (нужна заглушка иконки).
- `src/editor/index.tsx` страница подключает сама через `import.meta.glob` в `src/main.tsx`; модуль обязан вызвать `installEditor` из `src/state.ts`, иначе режима правки нет.
- `vitest.config.ts` перечисляет папки с тестами явно (`shared/`, `scripts/`, `tests/server|seed|web`, `src/`); тест в другой папке не запустится.
- `npm run catalog`: слоты берутся из `WHEEL_SLOTS_DIR`, нет папки — слоты качаются из сети.

## Окружение

Читает `server/main.ts`, если не сказано иное. Значений здесь нет.

- `ADMIN_PASSWORD` — пароль стримера; пусто — вход выключен.
- `SESSION_SECRET` — секрет подписи сессий; пусто — случайный на каждый запуск.
- `TRUSTED_PROXIES` — адреса или IPv4-подсети nginx, которым верить в `X-Forwarded-For`; пусто — заголовок не читается.
- `PORT` — порт сервера (8080); его же берёт `vite.config.ts` для прокси `/api` в dev.
- `DATA_DIR` — папка `values.json` и `changes.json` (`./data/runtime`).
- `SEED_FILE` — стартовые значения для первого запуска (`./data/seed/values.json`).
- `STATIC_DIR` — собранная страница (`./dist`); нет `index.html` — сервер отдаёт только API.
- `WHEEL_SLOTS_DIR` — откуда `scripts/catalog/build-catalog.ts` копирует готовые иконки слотов.
- `E2E_PORT` — первый из трёх портов e2e-серверов (4319); `E2E_ADMIN_PASSWORD` — тестовый пароль e2e (`e2e/env.ts`).
