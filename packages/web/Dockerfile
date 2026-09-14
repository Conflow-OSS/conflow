# Builds @content-engine/web: the Vite static bundle + its BFF.
#
# The build stage needs the whole workspace present for the same reason as
# packages/server/Dockerfile (npm workspaces + lockfile validation), but the
# runtime stage deliberately does NOT reuse that stage's node_modules — the
# ~150 UI packages in packages/web's real dependencies exist to feed the
# Vite build below and are already bundled into dist/, not needed as
# node_modules once the BFF is just serving static files + proxying.
# packages/web/server/package.json declares the three packages dist-server/
# index.js actually imports; that's all this stage installs.

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci

COPY packages/shared packages/shared
COPY packages/web packages/web
WORKDIR /app/packages/web
RUN npm run build && npm run bff:build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY packages/web/server/package.json ./package.json
RUN npm install --omit=dev

COPY --from=build /app/packages/web/dist dist
COPY --from=build /app/packages/web/dist-server dist-server

EXPOSE 4000
CMD ["node", "dist-server/index.js"]
