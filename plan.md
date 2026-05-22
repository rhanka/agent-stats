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

### WP1 — Repo bootstrap (status: 14/14, 100%)

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

**Lot 1.3 — Remote & CI** (3/3, 100%)

- [x] `gh repo create rhanka/agent-stats --public --source . --push`
- [x] `.github/workflows/ci.yml` : lint + typecheck + test + coverage
- [x] `.github/workflows/release.yml` (npm publish sur tag `v*`) — livré
      dans WP9

### WP2 — Parsers MVP (status: 10/10, 100%)

**Lot 2.1 — Schéma commun** (2/2, 100%)

- [x] Types `SessionEvent` (union discriminée), `SessionMeta`, `Usage`,
      `ToolCall`, etc.
- [x] `core/src/schema.ts` documenté inline

**Lot 2.2 — Parser Claude** (3/3, 100%)

- [x] `core/src/parsers/claude.ts` : streaming JSONL → `SessionEvent`
- [x] Fixtures hand-crafted dans `tests/fixtures/claude/`
- [x] Tests Vitest couvrant les sub-types (`tool_use`, `tool_result`,
      `usage`, `thinking`, `attachment`, user string content) — 6/6 verts

**Lot 2.3 — Parser Codex (via index sqlite)** (3/3, 100%)

- [x] `core/src/parsers/codex.ts` : utilise `~/.codex/state_5.sqlite`
      (table `threads`) pour filtrer, parse seulement les rollouts demandés
- [x] Fixtures + `better-sqlite3` adapter
- [x] Tests couvrant `event_msg` (`token_count`, `user_message`,
      `context_compacted`, `mcp_tool_call_end`, `exec_command_end`),
      `response_item` (`function_call`), `session_meta` — 10/10 verts

**Lot 2.4 — Collect API** (2/2, 100%)

- [x] `collect({sources, since, until, project?})` : iterator d'événements
- [x] Tests d'intégration parsers + collect (7 tests Vitest, dont scénarios
      both-sources, source-filter, project filter, time window)

### WP3 — Aggregations MVP (status: 8/8, 100%)

- [x] `aggregateWeekly(events, groupBy)` (week × project × tool × model)
- [x] Métrique volumétrie : tokens in/cached/out/reasoning
- [x] Métrique cache efficiency
- [x] Métrique sessions : nb, durée, turns/session
- [x] Métrique sub-agents : depth, parent→enfants
- [x] Métrique outils & skills
- [x] Coût estimé via rate card (cf. mémoire `reference_codex-quota-equation`)
- [x] Storage adapter `JsonStorage` (default) + interface `StorageAdapter`
      pour brancher surch / opendb plus tard

### WP4 — CLI MVP (status: 6/6, 100%)

- [x] Binary `agent-stats` (commander)
- [x] `agent-stats stats` (JSON, default ; table en option)
- [x] `agent-stats report` (Markdown rapport hebdo avec Totals/Top
      projects/Top models par semaine)
- [x] Flags `--since/--until/--tool/--project/--out/--format/--top`
- [x] Tests CLI (in-process : 4 stats + 3 report = 7 tests verts)
- [x] Doc `cli/README.md` détaillée

### WP6 — Cleanser secrets (status: 4/5, 80%)

- [x] Wrapper `secretlint` + preset recommend (28 rules : AWS, Anthropic,
      OpenAI, GitHub, GitLab, Slack, Stripe, JWT/privatekey, etc.)
- [ ] Custom Sentropic patterns (config yaml extensible) — différé
      (preset recommend suffisant pour MVP ; à reprendre si patterns
      internes apparaissent)
- [x] Modes `--archive` (default), `--inplace` (avec `.bak`), `--llm-input`
      (avec `--max-tool-result-bytes`)
- [x] CLI sub-command `agent-stats clean --input <path> --mode <m> --out <dir>`
- [x] Tests sur fixtures avec faux secrets (5 core + 4 cli = 9 verts)

### WP5 — Anomaly detection heuristiques (status: 4/4, 100%)

- [x] Règles déterministes : `runaway_compactions`, `high_error_rate`,
      `prompt_retry_loop`, `tool_loop`, `zombie_session` (les
      "insultes/négations" sont reportées à WP7 LLM puisque les prompts
      sont hashés — privacy by design)
- [x] `detectAnomalies(events, opts)` avec seuils customisables
      (compactions, error rate, retries, tool loop, gap minutes)
- [x] CLI sub-command `agent-stats anomalies` (JSON ou table, tri par
      severity descendante)
- [x] Tests : 8 core + 3 CLI = 11 verts

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

### WP9 — CI + release (status: 4/4, 100%)

- [x] Coverage report dans CI (`@vitest/coverage-v8`, upload artifact)
- [x] npm publish workflow (sur tag `v*` : provenance, NPM_TOKEN secret)
- [x] Release notes auto-générées (`git log` entre tags, push gh release)
- [x] `.github/workflows/release.yml` créé (publish core + cli)

---

## Status (mis à jour automatiquement)

| WP        | Titre                |  Total |   Done |       % | État        |
| --------- | -------------------- | -----: | -----: | ------: | ----------- |
| 1         | Repo bootstrap       |     14 |     14 |    100% | completed   |
| 2         | Parsers MVP          |     10 |     10 |    100% | completed   |
| 3         | Aggregations MVP     |      8 |      8 |    100% | completed   |
| 4         | CLI MVP              |      6 |      6 |    100% | completed   |
| 6         | Cleanser secrets     |      5 |      4 |     80% | in_progress |
| 5         | Anomaly heuristiques |      4 |      4 |    100% | completed   |
| 8         | Web dashboard        |      5 |      0 |      0% | pending     |
| 7         | Phase 2 LLM          |      5 |      0 |      0% | pending     |
| 9         | CI + release         |      4 |      4 |    100% | completed   |
| **Total** |                      | **61** | **50** | **82%** |             |

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
- 2026-05-18 : WP2 Lot 2.3 (parser Codex) complet. `indexCodexSessions()`
  via `better-sqlite3` (lit `state_5.sqlite` readonly), `parseCodexRollout()`
  streaming sur jsonl + fixture rollout + 10 tests Vitest verts (16 au total).
  Ajout de `*.tsbuildinfo` au .gitignore.
- 2026-05-18 : WP2 Lot 2.4 (Collect API) complet. `collect({sources, since,
until, projectCwd, ...})` async-iterator qui scanne `~/.claude/projects/`
  (avec décodage cwd) + appelle `indexCodexSessions` + `parseCodexRollout`.
  7 tests d'intégration (source filter, project filter, time window,
  decode). **WP2 clôturé à 100% (10/10, 23 tests verts au total).**
- 2026-05-18 : **WP3 Aggregations MVP clôturé à 100% (8/8).**
  `aggregateSessions()` (pass 1) → `bucketWeekly()` (pass 2), helper
  `aggregateWeekly()` end-to-end. Métriques volumétrie / cache efficiency /
  sessions (count, durée, turns) / sub-agents (uniqueParents) / outils
  (par catégorie et nom) / skills. Rate card avec devises strictement
  séparées (`codex_credits` vs `claude_usd_cents`). Storage adapter
  `JsonStorage` (default `~/.agent-stats/aggregations/<week>/<tool>.json`),
  interface `StorageAdapter` prête pour brancher surch / opendb plus tard.
  13 nouveaux tests (7 aggregations + 6 storage) → **36 verts au total.**
- 2026-05-18 : **WP4 CLI MVP clôturé à 100% (6/6).** Binary `agent-stats`
  via `commander`, subcommands `stats` (JSON/table) et `report` (Markdown
  hebdo avec Totals / Top projects / Top models). Flags `--since/--until/
--tool/--project/--out/--format/--top`. README CLI mis à jour avec
  exemples. 7 nouveaux tests (4 stats + 3 report) → **43 tests verts.**
- 2026-05-20 : **WP6 Cleanser secrets à 80% (4/5).** `secretlint` +
  preset-recommend (28 rule families). 3 modes : `archive`, `inplace`
  (avec `.bak`), `llm-input` (truncation des strings >
  `maxToolResultBytes`). CLI sub-command `agent-stats clean` (file ou
  dir). Tags de redaction stables `<<SECRET:<rule_id>:<sha256-16>>>`.
  Fixtures secrets construites à l'exécution (helper
  `tests/helpers/fake-secrets.ts`) pour passer la push-protection
  GitHub. 9 nouveaux tests (5 core + 4 CLI) → **52 verts.** Item différé :
  custom Sentropic patterns yaml.
- 2026-05-20 : **WP5 Anomaly heuristics clôturé à 100% (4/4).**
  `detectAnomalies(events, opts)` avec 5 patterns (`runaway_compactions`,
  `high_error_rate`, `prompt_retry_loop`, `tool_loop`, `zombie_session`),
  seuils customisables, severity low/medium/high dérivée du ratio
  par-rapport-au-seuil. CLI sub-command `agent-stats anomalies`
  (JSON/table, tri severity desc). 11 nouveaux tests (8 core + 3 CLI)
  → **63 tests verts.**
- 2026-05-21 : **WP9 CI + release clôturé à 100% (4/4) → WP1 → 100%.**
  Versions bumpées à `0.1.0` (core, cli, web + `VERSION`). Coverage
  v8 dans CI (94% moyenne, upload artifact). Workflow `release.yml`
  sur tag `v*` : vérifie que le tag matche les versions packages,
  publie core puis cli sur npm (avec provenance), crée une GitHub
  release avec changelog généré du `git log`. `CHANGELOG.md` racine.
  Pour publier : commit, `git tag v0.1.0`, `git push --tags`. Requiert
  `NPM_TOKEN` secret côté repo.

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
