# Local test images for docker-compose.local.yml. NOT the production deployment
# (SPEC §12 runs Node under systemd on the Droplet); this mirrors it closely
# enough to test the built app: compiled API, static SPA behind Nginx.
#
# Build context is the repo root.

FROM node:20-bookworm-slim AS build
# Prisma's query engine needs OpenSSL; argon2 compiles with node-gyp when no
# prebuilt binary matches, which needs Python and a C++ toolchain.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Manifests first so dependency installs are cached between code changes.
# The Prisma schema is needed by the API's postinstall (`prisma generate`).
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/api/prisma apps/api/prisma
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# API + tooling (migrations, seed, create-admin). Keeps dev dependencies,
# which the Prisma CLI and tsx need.
FROM build AS app
ENV NODE_ENV=development
RUN chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/index.js"]

# Built SPA served by Nginx, proxying /api to the API (same origin, SPEC §11).
FROM nginx:1.27-alpine AS web
COPY deploy/local/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
