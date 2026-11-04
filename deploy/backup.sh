#!/bin/sh
set -eu
if [ "${1:-loop}" != "once" ]; then
  while true; do
    if /usr/local/bin/matms-backup.sh once; then sleep 86400; else echo 'Backup failed; retrying in five minutes.' >&2; sleep 300; fi
  done
fi
umask 077
: "${MATMS_BACKUP_KEY:?Backup encryption key is required}"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump=$(mktemp /tmp/matms-backup.XXXXXX)
partial="/backups/matms-$stamp.dump.enc.partial"
trap 'rm -f "$dump" "$partial"' EXIT HUP INT TERM
pg_dump --format=custom --no-owner --no-acl --file="$dump"
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -pass env:MATMS_BACKUP_KEY -in "$dump" -out "$partial"
output="/backups/matms-$stamp.dump.enc"
mv "$partial" "$output"
(cd /backups && sha256sum "matms-$stamp.dump.enc" > "matms-$stamp.dump.enc.sha256")
find /backups -name 'matms-*.dump.enc*' -mtime +30 -delete
printf 'Encrypted database backup saved: %s\n' "$output"
