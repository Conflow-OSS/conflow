# Builds @content-engine/server — one image, two roles. docker-compose runs
# it as both the `api` and `worker` services, overriding CMD with
# ["node", "dist/worker/index.js"] for the worker.
#
# Needs the whole workspace present to build (npm workspaces resolves
# @content-engine/shared from packages/shared, and `npm ci` checks every
# workspace's package.json against the lockfile) even though only
# packages/server's own dependencies end up in the final image.

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci

COPY packages/shared packages/shared
COPY packages/server packages/server
RUN npm run build -w @content-engine/server
# Strips devDependencies (typescript, vitest, tsx, ...) from node_modules —
# still hoisted at the workspace root, but only production deps survive.
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/packages/server/package.json packages/server/package.json
COPY --from=build /app/packages/server/dist packages/server/dist

WORKDIR /app/packages/server
CMD ["node", "dist/api/server.js"]
