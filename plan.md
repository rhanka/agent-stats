# Plan — agent-stats (`@sentropic/agent-stats`)

## Mission

Analyser les sessions des CLI agentiques (Claude Code, Codex CLI), produire des
statistiques hebdomadaires sur une fenêtre glissante de 6 mois, détecter les
anomalies (frustration utilisateur, IA hors contrôle) et nettoyer les secrets
qui fuient dans les jsonl. Trois sorties : JSON, Markdown hebdo, dashboard web
Svelte/Vite local.

Repo : `rhanka/agent-stats` · Package umbrella : `@sentropic/agent-stats` ·
Stack : TypeScript ESM, Node 20+, Vitest, Vite+Svelte, esbuild.

---

## Mécanisme de mise à jour de ce plan

Après chaque commit ou tâche complétée :
1. Cocher l'item terminé (`[ ]` → `[x]`).
2. Recalculer le `status: X/Y, Z%` du workpackage concerné.
3. Recalculer le tableau **Status** global.
4. Ajouter une ligne dans **Done** (date + résumé court).
5. Refresh **En attente de toi** : retirer ce qui est débloqué, ajouter ce qui
   apparaît avec **préco** opinionée et **action attendue** concrète.
6. Logger les décisions structurantes dans **Décisions log**.

Le plan vit dans Git ; chaque commit qui modifie le code doit aussi mettre à
jour le plan.md (single source of truth living document).

---

## Workpackages

### WP1 — Repo bootstrap (status: 13/14, 93%)

**Lot 1.1 — Squelette workspace** (6/6, 100%)
- [x] Créer `~/src/agent-stats/`, `git init -b main`
- [x] Root `package.json` (workspaces: `packages/*`)
- [x] `tsconfig.base.json`, `tsconfig.json` par package
- [x] Vitest config root + per-package
- [x] ESLint + Prettier + EditorConfig (aligner sentropic)
- [x] `.gitignore` (Node, build, OS, IDE)

**Lot 1.2 — Stub des 3 packages** (5/5, 100%)
- [x] `packages/core` : `package.json` + `src/index.ts` minimal
- [x] `packages/cli` : `package.json` + `bin` + `src/index.ts` + `cli.ts`
- [x] `packages/web` : `package.json` + structure SvelteKit minimale (stub)
- [x] README racine + README par package
- [x] LICENSE (MIT)

**Lot 1.3 — Remote & CI** (2/3, 67%)
- [x] `gh repo create rhanka/agent-stats --public --source . --push`
- [x] `.github/workflows/ci.yml` : lint + typecheck + test
- [ ] `.github/workflows/release.yml` (npm publish) — différer à WP9

### WP2 — Parsers MVP (status: 0/8, 0%)

**Lot 2.1 — Schéma commun**
- [ ] Types `SessionEvent`, `SessionMeta`, `ProjectInfo`, `ToolCall`, `Usage`
- [ ] Doc inline du schéma dans `core/src/schema.ts`

**Lot 2.2 — Parser Claude**
- [ ] `parsers/claude.ts` : streaming JSONL, mapping vers `SessionEvent`
- [ ] Tests sur fixtures réelles (anonymisées) `tests/fixtures/claude/*.jsonl`
- [ ] Gestion `attachment` / `hook_success` / `tool_use` / `tool_result`

**Lot 2.3 — Parser Codex**
- [ ] `parsers/codex.ts` : streaming JSONL des rollouts, mapping schéma
- [ ] Tests sur fixtures `tests/fixtures/codex/*.jsonl`
- [ ] Gestion `event_msg` (`token_count`, `agent_message`, `task_*`,
      `compacted`, `mcp_tool_call_*`), `response_item`

**Lot 2.4 — Collect API**
- [ ] `collect({sources, since, until})` : iterator d'événements
- [ ] Tests d'intégration parsers + collect

### WP3 — Aggregations MVP (status: 0/7, 0%)

- [ ] `aggregateWeekly(events, groupBy)` (week × project × tool × model)
- [ ] Métrique volumétrie : tokens in/cached/out/reasoning
- [ ] Métrique cache efficiency
- [ ] Métrique sessions : nb, durée, turns/session
- [ ] Métrique sub-agents : depth, parent→enfants
- [ ] Métrique outils & skills
- [ ] Coût estimé via rate card (cf. mémoire `reference_codex-quota-equation`)

### WP4 — CLI MVP (status: 0/6, 0%)

- [ ] Binary `agent-stats` (commander ou yargs)
- [ ] `agent-stats stats` (JSON, default)
- [ ] `agent-stats report` (Markdown rapport hebdo)
- [ ] Flags `--since/--until/--tool/--project/--out/--format`
- [ ] Tests CLI (in-process + e2e small)
- [ ] Doc `cli/README.md` détaillée

### WP5 — Anomaly detection heuristiques (status: 0/4, 0%)

- [ ] Règles : insultes/négations, retries, IA loops, compactions runaway,
      error rate tools, sessions zombies
- [ ] `detectAnomalies(events, opts)` (heuristiques seulement, sans LLM)
- [ ] CLI sub-command `agent-stats anomalies`
- [ ] Tests

### WP6 — Cleanser secrets (status: 0/5, 0%)

- [ ] Wrapper `secretlint` + preset recommend
- [ ] Custom Sentropic patterns (config yaml extensible)
- [ ] Modes `--archive` (default), `--inplace` (avec `.bak`), `--llm-input`
- [ ] CLI sub-command `agent-stats clean`
- [ ] Tests sur fixtures avec faux secrets

### WP7 — Phase 2 LLM via `@sentropic/llm-mesh` (status: 0/5, 0%)

- [ ] Intégration `@sentropic/llm-mesh` (dep workspace)
- [ ] `analyzeWithLlm(session, opts)` produit verdict JSON
- [ ] Cache verdicts en sqlite local (`~/.agent-stats/db.sqlite`)
- [ ] CLI sub-command `agent-stats analyze`
- [ ] Module `bench` : eval set + comparaison modèles (mistral-small-4 par défaut)

### WP8 — Web dashboard (status: 0/5, 0%)

- [ ] SvelteKit app dans `packages/web`
- [ ] Pages : `/`, `/projects/[name]`, `/sessions/[id]`, `/anomalies`, `/bench`
- [ ] Adapter static, bundling via Vite
- [ ] Source de données : sqlite local + API thin
- [ ] CLI sub-command `agent-stats web` (lance serveur dev/prod local)

### WP9 — CI + release (status: 0/4, 0%)

- [ ] Coverage report dans CI
- [ ] npm publish workflow (sur tag)
- [ ] Release notes (changesets ?)
- [ ] `.github/workflows/release.yml` (issu de WP1 Lot 1.3 différé)

---

## Status (mis à jour automatiquement)

| WP | Titre | Total | Done | % | État |
|---|---|---:|---:|---:|---|
| 1 | Repo bootstrap | 14 | 13 | 93% | in_progress |
| 2 | Parsers MVP | 8 | 0 | 0% | pending |
| 3 | Aggregations MVP | 7 | 0 | 0% | pending |
| 4 | CLI MVP | 6 | 0 | 0% | pending |
| 5 | Anomaly heuristiques | 4 | 0 | 0% | pending |
| 6 | Cleanser secrets | 5 | 0 | 0% | pending |
| 7 | Phase 2 LLM | 5 | 0 | 0% | pending |
| 8 | Web dashboard | 5 | 0 | 0% | pending |
| 9 | CI + release | 4 | 0 | 0% | pending |
| **Total** | | **58** | **13** | **22%** | |

---

## Done (chronologique)

- 2026-05-18 : init repo local `~/src/agent-stats/`, `git init -b main`.
- 2026-05-18 : workspace scaffold complet (TS ESM, Vitest, ESLint, Prettier,
  EditorConfig, tsconfig.base + per-package, .gitignore).
- 2026-05-18 : 3 packages stubbés (`core`, `cli`, `web`) avec READMEs.
- 2026-05-18 : LICENSE MIT, README racine.
- 2026-05-18 : CI GitHub Actions (lint + typecheck + test).
- 2026-05-18 : remote créé public `rhanka/agent-stats`, initial commit poussé
  → https://github.com/rhanka/agent-stats

---

## En attente de toi (bloqueurs)

> Note : License (MIT) et visibilité (public) ont été choisies par défaut
> conformément aux préco. Tu peux les overrider à tout moment :
> - License → édite `LICENSE`
> - Visibilité → `gh repo edit rhanka/agent-stats --visibility private`

- **DB locale pour les verdicts / aggregations**
  - Préco : **SQLite via `better-sqlite3`**. Performant en sync, pas de
    daemon, déjà utilisé chez Anthropic/OpenAI pour leurs CLIs.
  - Action attendue : **valider SQLite** ou choisir JSON sur disque
    (simpler, slower for queries). À trancher avant de démarrer WP3.

- **Stratégie de parsing Codex rollouts (~12 Go)**
  - Préco : **indexer via `~/.codex/state_5.sqlite`** (table `threads`)
    et parser seulement les rollouts demandés par la fenêtre temporelle ou
    le filter projet. Évite de charger 12 Go inutilement.
  - Action attendue : **valider l'approche par index** ou demander un
    full-scan. À trancher avant de démarrer WP2 Lot 2.3.

- **Modèle de LLM par défaut pour la phase 2**
  - Préco : `mistral-small-4` via `@sentropic/llm-mesh`. À benchmarker
    contre `gpt-5.4-mini`, `claude-haiku-4-5` et `mistral-large-2` dans WP7.
  - Action attendue : **valider mistral-small-4 par défaut** ou imposer un
    autre modèle initial. À trancher avant de démarrer WP7.

- **Ordre des WP après WP1**
  - Préco : **WP2 → WP3 → WP4 → WP6 → WP5 → WP8 → WP7 → WP9**
    (parsers, agrégations, CLI stats/report, cleanser secrets vite pour
    confort opérationnel, anomalies heuristiques, web, LLM, release).
  - Action attendue : **valider l'ordre** ou réordonner explicitement.

---

## Décisions log

- 2026-05-18 :
  - Nom de package npm : `@sentropic/agent-stats` (umbrella CLI) +
    `@sentropic/agent-stats-core` (lib) + `@sentropic/agent-stats-web`
    (dashboard).
  - Repo GitHub : `rhanka/agent-stats`.
  - Sources : Claude + Codex (parsers parallèles).
  - 3 sorties simultanées : JSON natif + Markdown rapport + Dashboard web.
  - Workspace npm 3 packages.
  - Cleanser sémantique : redaction de secrets (passwords, tokens, API
    keys) via `secretlint` TypeScript natif.
  - Phase 2 LLM via `@sentropic/llm-mesh`, default Mistral Small 4.
  - Stack : TypeScript ESM, Node ≥20, Vitest, ESLint+Prettier,
    Vite+SvelteKit pour le web.
  - **License : MIT** (par défaut, conforme préco).
  - **Visibilité repo : public** (par défaut, conforme préco).
