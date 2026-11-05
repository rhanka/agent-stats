#!/usr/bin/env bash
# Install the agent-stats publisher outside the dev checkout, with a daily
# systemd user timer and a desktop notification on failure. Idempotent:
# re-run it to pick up a new version of run.sh.
#
#   scripts/publisher/install.sh
#
# Env overrides: AGENT_STATS_PUBLISHER_HOME (default ~/.local/share/agent-stats-publisher),
# AGENT_STATS_DATA_BRANCH (default published-data), AGENT_STATS_REMOTE (default: origin of this checkout).
set -euo pipefail

src_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
home="${AGENT_STATS_PUBLISHER_HOME:-${HOME}/.local/share/agent-stats-publisher}"
data_branch="${AGENT_STATS_DATA_BRANCH:-published-data}"
remote="${AGENT_STATS_REMOTE:-$(git -C "${src_dir}" remote get-url origin)}"
app="${home}/app"
data="${home}/data"
unit_dir="${HOME}/.config/systemd/user"
unit="agent-stats-published-data"

mkdir -p "${home}" "${unit_dir}"

# 1. Dedicated clone (code).
if [[ ! -d "${app}/.git" ]]; then
  git clone --quiet "${remote}" "${app}"
fi
git -C "${app}" fetch --quiet origin

# 2. Data worktree on the orphan `published-data` branch. Bootstrapped from
#    the JSON committed on main the first time the branch does not exist.
if [[ ! -e "${data}/.git" ]]; then
  if git -C "${app}" ls-remote --exit-code --heads origin "${data_branch}" >/dev/null; then
    git -C "${app}" fetch --quiet origin "${data_branch}"
    git -C "${app}" worktree add --quiet -B "${data_branch}" "${data}" "origin/${data_branch}"
  else
    git -C "${app}" worktree add --quiet --orphan -b "${data_branch}" "${data}"
    git -C "${app}" reset --quiet --hard origin/main
    cp "${app}"/packages/web/static/published-{stats,daily,anomalies,meta}.json "${data}/"
    git -C "${data}" add published-stats.json published-daily.json published-anomalies.json published-meta.json
    git -C "${data}" commit --quiet -m "chore: bootstrap published data from main"
    git -C "${data}" push --quiet -u origin "${data_branch}"
  fi
fi

# 3. Runner, copied so a reset of the clone never rewrites a running script.
install -m 0755 "${src_dir}/scripts/publisher/run.sh" "${home}/run.sh"

# 4. systemd user units. PATH is captured now: user units get a minimal one.
cat > "${unit_dir}/${unit}.service" <<SERVICE
[Unit]
Description=Refresh agent-stats published dashboard data
OnFailure=${unit}-failure.service

[Service]
Type=oneshot
WorkingDirectory=${home}
Environment=PATH=${PATH}
Environment=AGENT_STATS_PUBLISHER_HOME=${home}
Environment=AGENT_STATS_DATA_BRANCH=${data_branch}
ExecStart=/usr/bin/env bash ${home}/run.sh
SERVICE

cat > "${unit_dir}/${unit}-failure.service" <<SERVICE
[Unit]
Description=Alert on agent-stats publication failure

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash -c 'msg="agent-stats: daily publication failed (journalctl --user -u ${unit}.service)"; logger -t ${unit} "\$\$msg"; command -v notify-send >/dev/null && notify-send -u critical "agent-stats" "\$\$msg" || true'
SERVICE

cat > "${unit_dir}/${unit}.timer" <<TIMER
[Unit]
Description=Daily refresh of agent-stats published dashboard data

[Timer]
OnCalendar=*-*-* 07:30:00
Persistent=true
Unit=${unit}.service

[Install]
WantedBy=timers.target
TIMER

systemctl --user daemon-reload
systemctl --user enable --now "${unit}.timer"
systemctl --user list-timers "${unit}.timer"
