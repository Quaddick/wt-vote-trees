# Архитектура

Один Node-процесс отдаёт собранную страницу и JSON API. Каталог машин собран заранее и лежит в репозитории; значения коэффициентов и история правок — в файлах на диске. Слова — в `CONTEXT.md`, причины решений — в `docs/adr/`, запуск и выкладка — в `docs/DEPLOY.md`.

## Поток данных

1. Страница грузит каталог `GET catalog/trees.json` (`src/api.ts` → `loadCatalog`) и состояние `GET api/state`.
2. `src/state.ts` опрашивает `api/state` раз в 10 с с `If-None-Match`; при ошибке пауза растёт 10 → 20 → 40 → 60 с, статус связи виден в `ConnectionBanner`. Сервер отвечает 304, пока `version` не изменился (ADR 0003).
3. Стример входит `POST /api/login` (пароль → cookie `wtv_session`), правит `POST /api/edit`, отменяет `POST /api/undo`. Ответ правки — новый `StateResponse`, страница принимает его через `acceptState`.
4. `server/store.ts` применяет правку к `values.json`, дописывает запись в `changes.json` (атомарно: tmp + rename), `version` = `seq` последней записи.
5. Значения хранятся по ID машины вики. Нет записи = коэффициент 1. Каталог и значения не связаны жёстко: пропавшая из каталога машина не показывается, но её значение остаётся в файле; новая получает 1.
6. Каталог и стартовые значения получаются офлайн-скриптами, не рантаймом: `scripts/catalog` (вики → `public/catalog/`), `scripts/seed` (расшифровка скриншотов → `data/seed/values.json`). Сервер копирует seed в `DATA_DIR` при первом запуске, если `values.json` там ещё нет.

## Границы модулей

- `shared/types.ts` — контракт данных (`TreeCatalog`, `VehicleInfo`, `Value`, `Change`, `StateResponse`, `Edit`). Меняется только осознанно: от него зависят сервер, страница и скрипты.
- `shared/values.ts` — чистые функции над значениями: `applyEdit` (не мутирует вход, неизменившиеся машины в `items` не попадают), `parseCoefficient` (запятая = точка, ошибки по-русски), `formatValue`, `normalizeName`, `displayName` (правило имён, ADR 0004). Здесь тестовый шов для логики значений.
- `server/store.ts` — `openStore({ dataDir, seedFile, historyCap })`: формат файлов, атомарная запись, копирование seed, обрезка истории (1000). Битый файл — исключение с путём, файл не трогается. Неизвестный `seq` в `undo` — `NotFoundError`.
- `server/auth.ts` — `createAuth({ password, secret })`: токен `<exp>.<hmac>` (срок 30 дней), подпись зависит только от секрета и срока, не от пароля; лимит 5 ошибок на IP за 10 минут; пустой пароль — вход выключен (403).
- `server/app.ts` — `createApp({ store, auth, staticDir, trustedProxies })` возвращает `RequestListener`; тесты поднимают его на свободном порту. Отдаёт API, файлы из `staticDir` и `index.html` для остальных `GET`. `/catalog/*` кэшируется на сутки; нет файла в `/catalog/*` или `/assets/*` — 404.
- `server/main.ts` — только чтение окружения, сборка частей, запуск и остановка по сигналам.
- `src/state.ts` — единственный владелец состояния страницы (сигналы Preact); компоненты читают сигналы и зовут действия оттуда, `fetch` напрямую не вызывают. Сеть страницы — только `src/api.ts`.
- `src/editor/` — режим правки, подключается к странице через `installEditor({ onCardClick, Panel, Toolbar, ChangeActions })` из `src/state.ts`; `src/main.tsx` находит `src/editor/index.tsx` через `import.meta.glob`. Файл значений (`values-file.ts`): `{ kind: "wt-vote-trees/values", version: 1, exportedAt, values }`, при загрузке принимается и голая `ValueMap`.
- `scripts/catalog/` — `parseTreeLayout` и `parseBattleRating` читают HTML вики (фикстуры в `__fixtures__/`), `buildCatalog` собирает `trees.json`, слоты и флаги. Единственное место, которое ходит в интернет.
- `scripts/seed/` — `matchSeed` сопоставляет строки из `data/seed/raw/<нация>.json` с каталогом (по `nameEn`, затем `nameRu`, затем `name`; `id` в строке приоритетнее имени), `runSeed` пишет `values.json` и `docs/seed-report.md`, `runTiles` режет скриншоты в `data/seed/tiles/`.

## Соглашения

- Node 22, TypeScript strict, ES-модули, один `package.json` в корне. Тексты интерфейса и сообщения API — по-русски; код, идентификаторы, имена файлов — по-английски.
- Секретов в коде, тестах и коммитах нет; пароль — только из окружения.
- Ошибки API — JSON `{ error: string }` по-русски. Проверки сервера: изменяющий запрос с чужим `Origin` — 403; не `application/json` — 415; тело больше 256 КБ — 413; ID машины вне `[A-Za-z0-9_.-]{1,100}` или `__proto__` — 400; пустой `ids` — 400; неизвестные ID машин принимаются.
- X-Forwarded-For читается, только если соединение пришло от адреса из `TRUSTED_PROXIES` (ADR 0005); берётся последний адрес в заголовке.
- Каталог лежит в git (ADR 0002); рантайм в интернет не ходит.
- Имя машины на карточке: русское имя вики, если оно начинается с кириллицы, иначе английское; поиск идёт по обоим (ADR 0004).
- ID папки-группы типа `g` может совпасть с ID её первой машины — ключ ячейки в DOM берётся с префиксом типа (`src/components/TreeView.tsx`).
- Тесты: vitest в двух проектах (`node` — `shared/`, `scripts/`, `tests/server/`, `tests/seed/`; `web` в jsdom — `src/`, `tests/web/`), сквозные Playwright — в `e2e/`.
