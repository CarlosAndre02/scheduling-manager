# syntax=docker/dockerfile:1

# Kept in step with the "engines" field in package.json. .npmrc sets
# engine-strict, so a mismatch fails the build here instead of at runtime.
ARG NODE_VERSION=24

# ── build ─────────────────────────────────────────────────────────────────────
# Everything needed to compile lives and dies in this stage: TypeScript, jest,
# eslint, drizzle-kit. None of it reaches the published image.
FROM node:${NODE_VERSION}-slim AS build

# husky installs git hooks on `npm ci` and there is no .git here. This is the
# documented way to skip it; --ignore-scripts would also skip dependencies'
# legitimate install steps.
ENV HUSKY=0

WORKDIR /app

# Copied before the source so that editing a file does not invalidate the
# cached dependency layer.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src

# Emits dist/ and copies the migration SQL into it — the migrator reads those
# files at runtime, and tsc alone would leave them behind.
RUN npm run build

# Pruning in place reuses the resolution npm already made, instead of a second
# install that could resolve differently.
RUN npm prune --omit=dev

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS runtime

# Read by the error handler to decide whether a 500 may carry detail.
ENV NODE_ENV=production

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Certificate authorities the database is verified against — public material,
# not secrets. They travel in the image so that both the migration container and
# the running application get them without a network fetch or a credential, and
# so a replacement instance is identical to the one it replaces.
#
# No ENV points at them here on purpose: DATABASE_SSL_CA is set per environment,
# so running this same image against a plaintext database does not try to
# negotiate TLS. See certs/README.md.
COPY certs/ ./certs/

# The application runs `node`, never `npm`. Keeping npm here ships its own
# bundled dependencies, whose advisories are counted against this image even
# though nothing loads them, and hands anyone who gets a shell a package
# installer. Migrations invoke the compiled migrator directly instead.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# The official image ships this unprivileged user. Without it the process runs
# as root inside the container, and a container escape starts as root.
USER node

EXPOSE 4000

# /ready and not /health, because this is what a deploy gates on: it answers 503
# while draining *and* while the database is unreachable, which is the case a
# liveness check reports as fine and a release cannot serve through. The load
# balancer keeps polling /health — a dependency-aware check there would pull
# every replica at once over a blip. See src/app.ts.
#
# The endpoint bounds its own response below the timeout here, so a slow
# database is reported as not ready rather than as a probe that timed out.
#
# Node has global fetch, so this costs no extra package. Exec form here too:
# shell form would spawn a /bin/sh for every check, every interval, for the life
# of the container.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.SERVER_PORT||4000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Exec form on purpose. In shell form Docker runs `/bin/sh -c ...`, making sh
# PID 1 and node its grandchild; SIGTERM would reach sh, which does not forward
# it, so the graceful shutdown in src/index.ts would never run and Docker would
# SIGKILL the container with requests still in flight.
CMD ["node", "dist/index.js"]
