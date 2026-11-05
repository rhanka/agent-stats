#!/usr/bin/env bash
# Daily publication of the agent-stats dashboard data.
#
# Installed (copied) by scripts/publisher/install.sh into the publisher home,
# OUTSIDE any dev checkout. It never touches a working copy:
#   <home>/app   dedicated clone, hard-reset to origin/main (code)
#   <home>/data  worktree of the `published-data` orphan branch (the 4 JSON)
# The data is computed from this machine's local transcripts (~/.claude,
# ~/.codex, ~/.gemini), committed to `published-data`, then the Pages
# workflow is dispatched on main (it overlays `published-data` at build).
set -euo pipefail

home="${AGENT_STATS_PUBLISHER_HOME:-${HOME}/.local/share/agent-stats-publisher}"
data_branch="${AGENT_STATS_DATA_BRANCH:-published-data}"
app="${home}/app"
data="${home}/data"

echo "agent-stats publisher: $(date -Is)"

git -C "${app}" fetch --quiet origin main "${data_branch}"
git -C "${app}" reset --quiet --hard origin/main

# Reinstall dependencies only when the lockfile changed.
lock_hash="$(sha256sum "${app}/package-lock.json" | cut -d' ' -f1)"
if [[ ! -d "${app}/node_modules" || "$(cat "${home}/.lock-hash" 2>/dev/null)" != "${lock_hash}" ]]; then
  (cd "${app}" && npm ci --no-audit --no-fund)
  echo "${lock_hash}" > "${home}/.lock-hash"
fi
(cd "${app}" && npm run build --workspace packages/core && npm run build --workspace packages/cli)

git -C "${data}" reset --quiet --hard "origin/${data_branch}"

# The window starts at the previous publication (+ margin): any outage is
# caught up on the next successful run.
node "${app}/packages/web/scripts/build-published-data.mjs" \
  --incremental --incremental-days auto --out-dir "${data}"

if git -C "${data}" diff --quiet; then
  echo "No published data changes."
  exit 0
fi

git -C "${data}" add published-stats.json published-daily.json published-anomalies.json published-meta.json
git -C "${data}" commit --quiet -m "chore: refresh published stats"
git -C "${data}" push --quiet origin "HEAD:${data_branch}"

# Pages deploys from main only (github-pages environment): dispatch it there.
(cd "${app}" && gh workflow run pages.yml --ref main)
echo "Published and Pages deployment dispatched."
