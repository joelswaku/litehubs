FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

# Keep the monorepo lockfile intact. The API may later consume a shared
# package, so install from the workspace root rather than the api directory.
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/validation/package.json ./packages/validation/package.json
RUN npm ci

FROM dependencies AS build

COPY . .
RUN npm run build --workspace @litehubs/api

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/api/package.json ./api/package.json
COPY --from=build /app/api/dist ./api/dist
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/database ./database

# Private contracts and documents live below this directory. Railway must
# mount its persistent volume at /app/storage before this service is released.
RUN mkdir -p /app/storage/company-documents \
  && chown -R node:node /app

COPY api/scripts/prepare-private-storage.sh /usr/local/bin/prepare-private-storage
RUN chmod 755 /usr/local/bin/prepare-private-storage

# Railway attaches the persistent volume only when the container starts. It
# can therefore replace the image directory with a root-owned mount. Keep the
# one-time ownership repair in the entrypoint, then drop to the non-root Node
# account before the API begins accepting requests.
USER root
EXPOSE 5000

ENTRYPOINT ["/usr/local/bin/prepare-private-storage"]
CMD ["node", "api/dist/server.js"]