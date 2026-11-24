# v1.124.9 — pin the Node runtime (Node2Shell, CVE-2026-111497; Stripe notice FTV37SYWJ, 10/23).
#
# Nixpacks chose the Node version from package.json "engines" (">=18.0.0") and its own Nix
# snapshot, so prod's runtime was whatever Nixpacks felt like, and we could not say which. The
# official image tag below is the patched release. Bump it on purpose, never let it float.
FROM node:22.23.4-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Never run as root: a code-execution bug then can't write outside /app. Files are owned by
# node as they are copied; a `chown -R` afterwards re-copied all of node_modules (2+ min/build).
RUN chown node:node /app
USER node

# Dependencies first so they cache between deploys. --omit=dev: the build needs only
# @babel/* and terser, which are runtime dependencies.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node . .
RUN node scripts/build-client.js

CMD ["npm", "start"]
