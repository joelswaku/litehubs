FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/validation/package.json ./packages/validation/package.json
RUN npm ci

FROM dependencies AS build

WORKDIR /app
COPY . .

# Next.js compiles rewrite destinations at build time. On Railway, set this to
# the API's private address, for example http://litehubs-api.railway.internal:5000.
ARG API_ORIGIN
ENV API_ORIGIN=${API_ORIGIN}

# NEXT_PUBLIC_* is inlined into the client bundle during `next build`, so these
# have to arrive as build args. A Docker build sees only variables declared as
# ARG: setting them on the Railway service alone changes nothing here, the build
# falls through to the hardcoded defaults in the source, and the mistake is
# invisible because the site still works — just with the wrong values baked in.
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID
ENV NEXT_PUBLIC_GA_MEASUREMENT_ID=${NEXT_PUBLIC_GA_MEASUREMENT_ID}
ARG NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
ENV NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=${NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION}

RUN npm run build --workspace @litehubs/web

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# output: standalone keeps only the runtime server and its dependencies.
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./web/.next/static
COPY --from=build /app/web/public ./web/public

USER node
EXPOSE 3000

CMD ["node", "web/server.js"]