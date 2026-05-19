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

### WP2 — Parsers MVP (status: 5/10, 50%)

**Lot 2.1 — Schéma commun** (2/2, 100%)

- [x] Types `SessionEvent` (union discriminée), `SessionMeta`, `Usage`,
      `ToolCall`, etc.
- [x] `core/src/schema.ts` documenté inline

**Lot 2.2 — Parser Claude** (3/3, 100%)

- [x] `core/src/parsers/claude.ts` : streaming JSONL → `SessionEvent`
- [x] Fixtures hand-crafted dans `tests/fixtures/claude/`
- [x] Tests Vitest couvrant les sub-types (`tool_use`, `tool_result`,
      `usage`, `thinking`, `attachment`, user string content) — 6/6 verts

**Lot 2.3 — Parser Codex (via index sqlite)** (0/3)

- [ ] `core/src/parsers/codex.ts` : utilise `~/.codex/state_5.sqlite`
      (table `threads`) pour filtrer, parse seulement les rollouts demandés
- [ ] Fixtures + `better-sqlite3` adapter
- [ ] Tests couvrant `event_msg` (`token_count`, `agent_message`,
      `task_*`, `context_compacted`, `mcp_tool_call_*`, `web_search_*`),
      `response_item`, `compacted`, `session_meta`

**Lot 2.4 — Collect API** (0/2)

- [ ] `collect({sources, since, until, project?})` : iterator d'événements
- [ ] Tests d'intégration parsers + collect

### WP3 — Aggregations MVP (status: 0/8, 0%)

- [ ] `aggregateWeekly(events, groupBy)` (week × project × tool × model)
- [ ] Métrique volumétrie : tokens in/cached/out/reasoning
- [ ] Métrique cache efficiency
- [ ] Métrique sessions : nb, durée, turns/session
- [ ] Métrique sub-agents : depth, parent→enfants
- [ ] Métrique outils & skills
- [ ] Coût estimé via rate card (cf. mémoire `reference_codex-quota-equation`)
- [ ] Storage adapter `JsonStorage` (default) + interface `StorageAdapter`
      pour brancher surch / opendb plus tard

### WP4 — CLI MVP (status: 0/6, 0%)

- [ ] Binary `agent-stats` (commander ou yargs)
- [ ] `agent-stats stats` (JSON, default)
- [ ] `agent-stats report` (Markdown rapport hebdo)
- [ ] Flags `--since/--until/--tool/--project/--out/--format`
- [ ] Tests CLI (in-process + e2e small)
- [ ] Doc `cli/README.md` détaillée

### WP6 — Cleanser secrets (status: 0/5, 0%)

- [ ] Wrapper `secretlint` + preset recommend
- [ ] Custom Sentropic patterns (config yaml extensible)
- [ ] Modes `--archive` (default), `--inplace` (avec `.bak`), `--llm-input`
- [ ] CLI sub-command `agent-stats clean`
- [ ] Tests sur fixtures avec faux secrets

### WP5 — Anomaly detection heuristiques (status: 0/4, 0%)

- [ ] Règles : insultes/négations, retries, IA loops, compactions runaway,
      error rate tools, sessions zombies
- [ ] `detectAnomalies(events, opts)` (heuristiques seulement, sans LLM)
- [ ] CLI sub-command `agent-stats anomalies`
- [ ] Tests

### WP8 — Web dashboard (status: 0/5, 0%)

- [ ] SvelteKit app dans `packages/web`
- [ ] Pages : `/`, `/projects/[name]`, `/sessions/[id]`, `/anomalies`, `/bench`
- [ ] Adapter static, bundling via Vite
- [ ] Source de données : storage adapter (JSON ou surch/opendb si mature)
- [ ] CLI sub-command `agent-stats web` (lance serveur dev/prod local)

### WP7 — Phase 2 LLM via `@sentropic/llm-mesh` (status: 0/5, 0%)

- [ ] Intégration `@sentropic/llm-mesh` (dep workspace)
- [ ] `analyzeWithLlm(session, opts)` produit verdict JSON
- [ ] Cache verdicts dans le storage adapter actif
- [ ] CLI sub-command `agent-stats analyze`
- [ ] Module `bench` : eval set + comparaison modèles (mistral-small-4 par défaut)

### WP9 — CI + release (status: 0/4, 0%)

- [ ] Coverage report dans CI
- [ ] npm publish workflow (sur tag)
- [ ] Release notes (changesets ?)
- [ ] `.github/workflows/release.yml` (issu de WP1 Lot 1.3 différé)

---

## Status (mis à jour automatiquement)

| WP        | Titre                |  Total |   Done |       % | État        |
| --------- | -------------------- | -----: | -----: | ------: | ----------- |
| 1         | Repo bootstrap       |     14 |     13 |     93% | in_progress |
| 2         | Parsers MVP          |     10 |      5 |     50% | in_progress |
| 3         | Aggregations MVP     |      8 |      0 |      0% | pending     |
| 4         | CLI MVP              |      6 |      0 |      0% | pending     |
| 6         | Cleanser secrets     |      5 |      0 |      0% | pending     |
| 5         | Anomaly heuristiques |      4 |      0 |      0% | pending     |
| 8         | Web dashboard        |      5 |      0 |      0% | pending     |
| 7         | Phase 2 LLM          |      5 |      0 |      0% | pending     |
| 9         | CI + release         |      4 |      0 |      0% | pending     |
| **Total** |                      | **61** | **18** | **30%** |             |

Ordre validé : WP2 → 3 → 4 → 6 → 5 → 8 → 7 → 9.

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
- 2026-05-18 : 4 bloqueurs résolus (storage adapter JSON par défaut +
  swap surch/opendb, parsing Codex via index sqlite, LLM default
  mistral-small-4, ordre WP2→3→4→6→5→8→7→9).
- 2026-05-18 : WP2 Lot 2.1 (schéma commun) + Lot 2.2 (parser Claude)
  complets. `SessionEvent`, `Usage`, `SessionMeta` + parser streaming
  JSONL Claude + fixture hand-crafted + 6 tests Vitest verts.
  Format/lint/typecheck passent en CI local.

---

## En attente de toi (bloqueurs)

> Aucun bloqueur actif. Les 4 décisions structurantes ont été tranchées
> (cf. Décisions log).

Les prochaines questions arriveront si un choix structurant émerge pendant
l'implémentation (typiquement : format du fichier secrets-patterns en WP6,
modèle exact pour eval set en WP7, format dashboard en WP8).

---

## Décisions log

- 2026-05-18 (bootstrap) :
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
  - License : MIT.
  - Visibilité repo : public.

- 2026-05-18 (post-bootstrap) :
  - **Storage adapter** : JSON sur disque par défaut (`~/.agent-stats/`).
    Interface `StorageAdapter` exposée pour brancher plus tard les bases
    `surch` ou `opendb` (sibling repos `../surch` `../opendb`) quand
    matures.
  - **Parsing Codex** : index via `~/.codex/state_5.sqlite` (table
    `threads`), parse à la demande les rollouts filtrés.
  - **LLM phase 2 default** : `mistral-small-4` (sera benchmarké en WP7
    contre `claude-haiku-4-5`, `gpt-5.4-mini`, autres).
  - **Ordre d'attaque** : WP2 → 3 → 4 → 6 → 5 → 8 → 7 → 9.
