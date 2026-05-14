# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:lts-alpine

# ---- deps: install all dependencies, cached separately from sources ---------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile TypeScript to dist/ -------------------------------------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- runtime: production-only deps + compiled output + migrations ----------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Migrations are read at boot when RUN_MIGRATIONS_ON_BOOT=true
COPY drizzle ./drizzle
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
