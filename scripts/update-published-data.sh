#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_dir}"

npm run data:published:incremental

if git diff --quiet -- packages/web/static; then
  echo "No published data changes."
  exit 0
fi

git add packages/web/static/published-stats.json \
  packages/web/static/published-daily.json \
  packages/web/static/published-anomalies.json \
  packages/web/static/published-meta.json
git commit -m "chore: refresh published stats"
git push
