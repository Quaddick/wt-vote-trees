# syntax=docker/dockerfile:1

# --- сборка страницы (vite build) и проверка типов сервера ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# data/seed может ещё не быть — тогда сервер стартует со значениями «1» и предупреждением.
RUN npm run build && mkdir -p data/seed

# --- рабочий образ: только runtime-зависимости, собранная страница и код сервера ---
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data/runtime \
    SEED_FILE=/app/seed/values.json \
    STATIC_DIR=/app/dist
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/data/seed ./seed
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:8080/api/state || exit 1
CMD ["node", "--import", "tsx", "server/main.ts"]
