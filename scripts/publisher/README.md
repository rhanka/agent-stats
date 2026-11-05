# Published dashboard data — publisher

The public dashboard (GitHub Pages) shows the maintainer's real usage. That
data can only be computed on the machine that holds the transcripts
(`~/.claude`, `~/.codex`, `~/.gemini`), so CI cannot produce it.

## Layout

| Where                                                               | What                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `~/.local/share/agent-stats-publisher/app`                          | dedicated clone, hard-reset to `origin/main` on every run                 |
| `~/.local/share/agent-stats-publisher/data`                         | worktree of the `published-data` orphan branch (the 4 `published-*.json`) |
| `~/.local/share/agent-stats-publisher/run.sh`                       | copy of `scripts/publisher/run.sh`                                        |
| `~/.config/systemd/user/agent-stats-published-data.{timer,service}` | daily run at 07:30 (`Persistent=true`)                                    |
| `~/.config/systemd/user/agent-stats-published-data-failure.service` | `OnFailure`: journal + desktop notification                               |

No dev checkout is ever touched, and `main` no longer receives a data commit
per day.

## Flow

1. `run.sh` resets the clone to `origin/main`, builds core + cli.
2. `build-published-data.mjs --incremental --incremental-days auto --out-dir data/`
   rebuilds everything since the previous publication (`published-meta.json`
   `generatedAt`) plus 7 days: an outage of any length is caught up on the next
   successful run.
3. Where the local transcripts are gone (Claude Code purges sessions after
   `cleanupPeriodDays`, 30 by default), the previously published rows are
   kept instead of being overwritten with lower counts.
4. The JSON is committed to `published-data`, then `pages.yml` is dispatched
   on `main`; it overlays `published-data` onto `packages/web/static/` before
   building. The JSON still committed on `main` is only a fallback.
5. The dashboard shows a warning banner when the snapshot is older than 3 days.

## Install / update

```bash
scripts/publisher/install.sh        # idempotent; re-run after changing run.sh
systemctl --user start agent-stats-published-data.service   # run now
journalctl --user -u agent-stats-published-data.service     # logs
```

Requires `gh` authenticated (workflow dispatch) and push access to the repo.
On first install, the `published-data` branch is bootstrapped from the JSON
committed on `main` if it does not exist yet.
