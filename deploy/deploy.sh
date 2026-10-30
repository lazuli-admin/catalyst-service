#!/usr/bin/env bash
# Run on the droplet as root: clone/update the repo, then rebuild and restart
# the catalyst compose project. Idempotent. GITHUB_TOKEN (optional) is used only
# for the fetch URL and is never persisted or printed.
set -euo pipefail

REPO_DIR=/opt/catalyst-service
BRANCH=${BRANCH:-development}

if [ -d "$REPO_DIR/.git" ]; then
  cd "$REPO_DIR"
  url="https://github.com/lazuli-admin/catalyst-service"
  [ -n "${GITHUB_TOKEN:-}" ] && url="https://x-access-token:$GITHUB_TOKEN@github.com/lazuli-admin/catalyst-service"
  git fetch --quiet "$url" "$BRANCH"
  git checkout --quiet "$BRANCH"
  git reset --quiet --hard FETCH_HEAD
else
  url="https://github.com/lazuli-admin/catalyst-service"
  [ -n "${GITHUB_TOKEN:-}" ] && url="https://x-access-token:$GITHUB_TOKEN@github.com/lazuli-admin/catalyst-service"
  git clone --quiet --branch "$BRANCH" "$url" "$REPO_DIR"
  cd "$REPO_DIR"
fi
git remote set-url origin https://github.com/lazuli-admin/catalyst-service

ENV_FILE="$REPO_DIR/deploy/.env"
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE missing; create it (see deploy/README.md) before deploying." >&2; exit 1; }
chmod 600 "$ENV_FILE"

docker compose -p catalyst -f deploy/docker-compose.yml up -d --build

for _ in $(seq 1 45); do
  if curl -fsS localhost:8787/health >/dev/null 2>&1; then
    echo "healthy"
    exit 0
  fi
  sleep 2
done

echo "health check failed after 90s; last 50 log lines:" >&2
docker compose -p catalyst -f deploy/docker-compose.yml logs --tail 50 >&2
exit 1
