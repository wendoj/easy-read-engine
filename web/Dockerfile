# Web app: Next.js standalone server plus system Chromium for PDF export.
#
# Build context is web/. prompts/ lives at the repo root, so it comes in as a
# second named context (docker-compose.yml sets it as additional_contexts):
#   docker build --build-context prompts=prompts -t easy-read-web web

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS runner
# Chromium and its libraries, and fonts for the PDF (Liberation for Arial-like
# sans, DejaVu for wide Unicode coverage).
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    CHROMIUM_PATH=/usr/bin/chromium \
    SYMBOL_CACHE_DIR=/data/symbol-cache

WORKDIR /app
# server.js, the traced node_modules and the bundled code (including the
# recorded samples in data/samples, which are imported, not read at run time).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/data/samples ./data/samples
# The prompt loader looks for ./prompts under the working directory.
COPY --from=prompts . ./prompts

# The only writable place: the pictogram cache. A new named volume mounted
# here takes this directory's owner, so the node user can write to it.
RUN mkdir -p /data/symbol-cache && chown node:node /data/symbol-cache
VOLUME ["/data/symbol-cache"]

# Non-root (the node image's uid 1000).
USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "server.js"]
