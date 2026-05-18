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

| Package | Rôle |
|---|---|
| `@sentropic/agent-stats-core` | Parsing (Claude + Codex), aggregations, schéma commun |
| `@sentropic/agent-stats` | CLI `agent-stats` (binary umbrella) |
| `@sentropic/agent-stats-web` | Dashboard local Svelte/Vite |

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

## Licence

MIT (sous réserve de confirmation finale — cf. plan.md).
