# WT Vote Trees

Сайт с деревьями наземной техники War Thunder по нациям. На каждой машине выставлен коэффициент или блок — для голосовалки на стриме. Зрители открывают сайт и смотрят значения, стример входит по паролю и правит их (с историей и отменой).

Данные о технике и иконки взяты из вики War Thunder. Это неофициальный фанатский проект.

## Как развернуть на своём сервере

Нужны сервер с Docker (с плагином `docker compose`) и, если сайт должен открываться по домену с https, nginx.

```bash
git clone <адрес этого репозитория> wt-vote-trees
cd wt-vote-trees
cp .env.example .env
# впиши в .env свой ADMIN_PASSWORD и SESSION_SECRET (openssl rand -hex 32)
docker compose up -d --build
```

Сайт откроется на `http://127.0.0.1:8080`. Порт слушает только эту машину: чтобы открыть сайт наружу, поставь перед ним nginx с https. Готовый пример конфига и объяснение, зачем нужны `Host`, `X-Forwarded-Proto` и `TRUSTED_PROXIES`, — в [docs/DEPLOY.md](docs/DEPLOY.md).

Значения и история правок лежат в `data/runtime/` на сервере. Контейнер можно пересобирать и удалять, данные останутся. Бэкап — раздел 5 в `docs/DEPLOY.md`.

Обновление: `git pull && docker compose up -d --build`.

## Если разворачивает нейросеть

Дай ей ссылку на этот репозиторий и свой сервер (доступ по SSH). Что ей читать:

1. [docs/DEPLOY.md](docs/DEPLOY.md) — запуск, nginx, https, `TRUSTED_PROXIES`, бэкап.
2. [AGENTS.md](AGENTS.md) — команды, структура проекта, подводные камни и переменные окружения.

Пароль `ADMIN_PASSWORD` лучше вписать в `.env` на сервере самому и не пересылать в чате с нейросетью.

## Локально

Нужен Node 22+.

```bash
npm ci
npm run check        # проверка типов и тесты
npm run build
ADMIN_PASSWORD=<пароль> PORT=3917 npm start
```

Подробнее — в [AGENTS.md](AGENTS.md).
