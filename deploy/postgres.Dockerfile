FROM postgres:18
RUN if ! command -v openssl >/dev/null; then apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*; fi
COPY deploy/init-app-role.sh /docker-entrypoint-initdb.d/10-matms-app-role.sh
COPY deploy/backup.sh /usr/local/bin/matms-backup.sh
RUN chmod 755 /docker-entrypoint-initdb.d/10-matms-app-role.sh /usr/local/bin/matms-backup.sh && mkdir -p /backups && chown postgres:postgres /backups
