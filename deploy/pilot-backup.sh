#!/usr/bin/env bash
# Dumps the pilot database. Schedule it, for example: 0 2 * * * /path/to/deploy/pilot-backup.sh
# Keep RELAY_SECRET safe too: encrypted files and keys in the dump are unreadable without it.
set -euo pipefail
cd "$(dirname "$0")/.."
dir="${BACKUP_DIR:-./backups}"
mkdir -p "$dir"
file="$dir/voice-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose --env-file .env.pilot -f deploy/docker-compose.pilot.yml exec -T postgres pg_dump -U voice voice | gzip >"$file"
find "$dir" -name 'voice-*.sql.gz' -mtime +14 -delete
echo "Saved $file"
