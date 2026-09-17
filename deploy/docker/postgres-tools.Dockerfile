FROM node:24-bookworm-slim AS config-reader-build
WORKDIR /build
RUN npm install --no-audit --no-fund yaml@2.9.1 esbuild@0.28.2
COPY deploy/docker/config-reader.mjs ./config-reader.mjs
RUN ./node_modules/.bin/esbuild config-reader.mjs --bundle --platform=node --target=node24 --format=esm --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' --outfile=config-reader.bundle.mjs

FROM postgres:18-bookworm

USER root
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates libstdc++6 libatomic1 util-linux \
  && rm -rf /var/lib/apt/lists/* \
  && install -d -m 0755 /opt/moemail \
  && groupadd --gid 10001 moemail \
  && useradd --uid 10001 --gid moemail --create-home --home-dir /home/moemail moemail \
  && install -d -o moemail -g moemail -m 0700 \
    /app/data /app/data/postgres-backups /backups
COPY --from=config-reader-build /usr/local/bin/node /usr/local/bin/node
COPY --from=config-reader-build --chmod=0444 /build/config-reader.bundle.mjs /opt/moemail/config-reader.mjs
COPY --chmod=0444 deploy/docker/postgres-verify.sql /opt/moemail/postgres-verify.sql
COPY --chmod=0555 deploy/docker/postgres-backup.sh /usr/local/bin/moemail-postgres-backup
COPY --chmod=0555 deploy/docker/postgres-restore.sh /usr/local/bin/moemail-postgres-restore
COPY --chmod=0555 deploy/docker/postgres-backup-scheduler.sh /usr/local/bin/moemail-postgres-backup-scheduler
USER moemail
