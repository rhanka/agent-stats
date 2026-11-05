# agent-stats

Analyseur de sessions pour CLI agentiques (Claude Code, Codex CLI). Produit
des statistiques hebdomadaires, détecte les anomalies, nettoie les secrets
dans les jsonl.

> Status : MVP en cours. Voir [`plan.md`](./plan.md) pour le détail des
> workpackages, l'état d'avancement et les décisions en attente.

## Stack

- TypeScript, ESM, Node ≥ 20
- Vitest (tests), ESLint + Prettier
- npm workspaces : `packages/core`, `packages/cli`, `packages/web`
- `packages/web` : SvelteKit + Vite + adapter-static

## Packages

| Package                       | Rôle                                                  |
| ----------------------------- | ----------------------------------------------------- |
| `@sentropic/agent-stats-core` | Parsing (Claude + Codex), aggregations, schéma commun |
| `@sentropic/agent-stats`      | CLI `agent-stats` (binary umbrella)                   |
| `@sentropic/agent-stats-web`  | Dashboard local Svelte/Vite                           |

## Usage (prévu, pas encore disponible)

```bash
npm install -g @sentropic/agent-stats

agent-stats stats              # JSON dump des stats (default last 7d)
agent-stats report             # Markdown rapport hebdo
agent-stats anomalies          # heuristiques (frustration + IA hors contrôle)
agent-stats clean              # redact secrets dans jsonl (secretlint)
agent-stats analyze            # analyse LLM via @sentropic/llm-mesh
agent-stats web                # lance le dashboard local
agent-stats bench              # benchmark modèles
```

## Développement

```bash
git clone https://github.com/rhanka/agent-stats.git
cd agent-stats
npm install
npm run build
npm test
```

## Purging leaked secrets from a session transcript

When a kubeconfig (or any other secret) leaked into a session transcript
(`~/.claude/projects/…/*.jsonl`, Codex rollouts, …), purge it with
`verify` → `clean --mode inplace --no-backup` → `verify`.

`agent-stats verify` takes a file plus env-var NAMES and reads the values
from a `.env` file through a file descriptor: values never appear in `argv`
nor on `stdout`. Only names, counts and sha256 fingerprints are printed, and
the command exits non-zero while any count is above zero. `agent-stats clean`
redacts with secretlint plus the built-in kubeconfig patterns
(`packages/core/patterns/kubeconfig.yaml`: base64 kubeconfig blob,
`client-key-data`, `client-certificate-data`, `token`,
`certificate-authority-data`).

```bash
export SESSION_JSONL="$HOME/.claude/projects/<project>/<session>.jsonl"
export SECRETS_ENV="$HOME/.config/agent-stats/secrets.env" # KEY=value lines, chmod 0600

# 1. Verify before (exit 1 = leak present; expect counts above 0).
agent-stats verify --file "$SESSION_JSONL" --env-file "$SECRETS_ENV" KUBECONFIG_TOKEN KUBECONFIG_CLIENT_KEY_DATA

# 2. Clean in place with NO backup beside the file (a .bak would keep the secret).
agent-stats clean --input "$SESSION_JSONL" --mode inplace --no-backup

# 3. Verify after (exit 0 = clean; every count must be 0).
agent-stats verify --file "$SESSION_JSONL" --env-file "$SECRETS_ENV" KUBECONFIG_TOKEN KUBECONFIG_CLIENT_KEY_DATA
```

Prefer `--backup-dir <dir>` over the default `.bak` when a backup is wanted:
backups land under `<dir>` (mirroring the input tree) with mode 0600, never
beside the cleaned file.

### Optional automation (examples for the owner — NOT installed)

The two snippets below are examples for owner approval only. Nothing here is
installed by the repo; the owner copies and adapts them explicitly.

SessionEnd hook example (`~/.claude/settings.json`): re-verify the session
transcript after each session and append the counts to a local log (stdout
only — stderr stays on the console so error text is never persisted).

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "agent-stats verify --file \"$SESSION_JSONL\" --env-file \"$HOME/.config/agent-stats/secrets.env\" KUBECONFIG_TOKEN >> ~/.config/agent-stats/verify.log"
          }
        ]
      }
    ]
  }
}
```

systemd user timer example: nightly verify over the transcript directory.

```ini
# ~/.config/systemd/user/agent-stats-verify.service
[Unit]
Description=Verify agent session transcripts for leaked secrets

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'for f in %h/.claude/projects/*/*.jsonl; do agent-stats verify --file "$f" --env-file %h/.config/agent-stats/secrets.env KUBECONFIG_TOKEN || echo "LEAK in $f"; done'
```

```ini
# ~/.config/systemd/user/agent-stats-verify.timer
[Unit]
Description=Daily verify of agent session transcripts

[Timer]
OnCalendar=*-*-* 07:30:00
Persistent=true
Unit=agent-stats-verify.service

[Install]
WantedBy=timers.target
```

Enable only after review: `systemctl --user daemon-reload &&
systemctl --user enable --now agent-stats-verify.timer`.

## Licence

MIT (sous réserve de confirmation finale — cf. plan.md).
