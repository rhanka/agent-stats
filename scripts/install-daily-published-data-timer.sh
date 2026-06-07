#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unit_dir="${HOME}/.config/systemd/user"
service_file="${unit_dir}/agent-stats-published-data.service"
timer_file="${unit_dir}/agent-stats-published-data.timer"

mkdir -p "${unit_dir}"

cat > "${service_file}" <<SERVICE
[Unit]
Description=Refresh agent-stats published dashboard data

[Service]
Type=oneshot
WorkingDirectory=${repo_dir}
ExecStart=/usr/bin/env bash ${repo_dir}/scripts/update-published-data.sh
SERVICE

cat > "${timer_file}" <<TIMER
[Unit]
Description=Daily refresh of agent-stats published dashboard data

[Timer]
OnCalendar=*-*-* 07:30:00
Persistent=true
Unit=agent-stats-published-data.service

[Install]
WantedBy=timers.target
TIMER

systemctl --user daemon-reload
systemctl --user enable --now agent-stats-published-data.timer
systemctl --user list-timers agent-stats-published-data.timer
