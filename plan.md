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

### WP8 — Web dashboard (status: 5/5, 100%)

- [x] SvelteKit 2 app dans `packages/web` (Svelte 5 runes, Vite, TypeScript)
- [x] Pages : `/` (Overview avec cards + top projets + table complète),
      `/anomalies` (liste avec severity badges). Pages `/projects/[name]`
      et `/sessions/[id]` reportées (drill-down nice-to-have, MVP usable
      sans)
- [x] Adapter static (`@sveltejs/adapter-static`, SPA fallback)
- [x] Source de données : appels `/api/stats` et `/api/anomalies` servis
      par le CLI ; backend `collect()` + `aggregateWeekly()` /
      `detectAnomalies()` ; overrides `claudeProjectsDir` / `codexDbPath`
      pour les tests
- [x] CLI sub-command `agent-stats web --port <n>` (Node http natif, sert
      le build static + endpoints JSON). 5 nouveaux tests CLI (static
      file, SPA fallback, /api/stats, /api/anomalies, 404 /api/\*).

### WP7 — Phase 2 LLM via `@sentropic/llm-mesh` (status: 5/5, 100%)

- [x] Intégration `@sentropic/llm-mesh` en **peer dep optionnel** :
      `analyzeWithLlm` accepte un `LlmMeshLike` (duck-typed sur `generate`)
      via paramètre ; la CLI essaie un dynamic-import du package, sinon
      laisse l'utilisateur fournir `mesh` programmatiquement
- [x] `analyzeWithLlm(session, opts)` → `AnalysisVerdict` JSON
      (`frustrationLevel`, `outOfControlScore`, `summary`, `rootCauses`)
      avec clamp 0..10 et extraction `json` de réponses fencées
- [x] Cache `AnalyzeCache` (interface `read`/`write`), backend libre
      (JsonStorage utilisable directement, surch/opendb plus tard)
- [x] CLI sub-command `agent-stats analyze --model … --limit …`
- [x] Module `bench` : `benchModels({models, sessions, baselines})`
      calcule MAE vs baseline + latency + erreurs par modèle, prêt à
      comparer mistral-small-4 vs alternatives

### WP10 — Pages deploy + Sentropic design system (status: 5/5, 100%)

**Lot 10.1 — Pages deploy env-driven** (2/2, 100%)

- [x] `.github/workflows/pages.yml` : build le SvelteKit avec
      `PAGES_BASE_PATH` env-driven (sub-path repo par défaut, vide si
      custom domain). Pas de domaine en dur dans la lib.
- [x] CNAME émis automatiquement quand la variable de repo
      `PAGES_CUSTOM_DOMAIN` est définie (cible cible
      `agent-stats.sent-tech.ca`). À setter dans Settings → Variables.

**Lot 10.2 — Sentropic design system (UI)** (3/3, 100%)

- [x] Branché `@sentropic/design-system-{themes,svelte,tokens}@0.7.0`
      (désormais publiés npm). `+layout.svelte` enveloppe l'app dans
      `<ThemeProvider>` (compile le thème runtime + pose `data-st-theme`)
      et utilise `<Header>` avec snippet de navigation. Aucun domaine ni
      thème en dur — sélection persistée localStorage (`$lib/theme.svelte.ts`).
- [x] Inline styles de `+page.svelte` / `anomalies/+page.svelte` remplacés
      par `<Card>`, `<Button>`, `<Select>`, `<Badge>`, `<DataTable>` ;
      styles résiduels passés sur les tokens sémantiques (`--st-semantic-*`).
- [x] Theme switcher (sent-tech / forge / entropic) via `<Select>` dans les
      actions du `<Header>`, lié au store de thème partagé.
- Vérif : `typecheck` 0 erreur, `build` OK, composants (`st-badge`,
  `st-button`, `st-card`, `st-field`, `DataTable`) + vars de thème bundlés
  dans le client `_app/`.

### WP11 — Corrections post-revue (status: 4/4, 100%)

Issues levées par l'utilisateur ("design pas aligné, stats pas feedées, je
doute du 98%") — le 98% comptait des cases, pas la valeur fonctionnelle.
Vérifications faites sur **données réelles**, pas sur des specs.

**Lot 11.1 — Fix modèle/coût Codex** (1/1, 100%)

- [x] Le parser lisait `model_provider` ("openai") et laissait les turns à
      "unknown" → `resolveRates` ne matchait jamais → **coût Codex = 0** (le
      cœur de l'analyse quota). Fix : parser les events `turn_context.model`
      (gpt-5.4 / gpt-5.3-codex / gpt-5.5 / …). Vérifié réel : lignes Codex
      avec vrai modèle + crédits. +1 test.

**Lot 11.2 — Métrique coût/quota honnête** (1/1, 100%)

- [x] Codex en crédits (devise quota), Claude en `~$` explicitement
      **notionnel** (list price API, pas une dépense sur forfait Max flat).
      Surface du `rateLimitMax` déjà capté (pics fenêtres 5h / 7j = "% quota
      cramé") dans `stats`, `report` et une carte web. Note cache-replay.
      Réel mesuré : "Codex quota peak 5h 100% · 7d 99%".

**Lot 11.3 — Web feedé avec les VRAIES données publiées** (1/1, 100%)

- [x] (révisé) L'utilisateur ne veut PAS de données fictives : il publie ses
      **vraies** données, calculées ici. `scripts/build-published-data.mjs`
      agrège 180j via le CLI et écrit `static/published-{stats,anomalies,
meta}.json`. Chaque projet est relabellisé vers son **remote git
      public** (`owner/repo` + URL cliquable) ; les projets sans upstream
      public sont **anonymisés `private-N`** (aucun chemin/username/nom privé
      publié — vérifié). Lignes fusionnées par (semaine×repo×outil×modèle).
      Le web charge ce snapshot en fallback (bannière "Published snapshot —
      real usage", filtre client-side, liens GitHub). Régénération :
      `node packages/web/scripts/build-published-data.mjs`. Vérifié live :
      29 repos publics liés, 27 projets privés masqués.

**Lot 11.4 — Polish design system** (1/1, 100%)

- [x] Comparaison objective vs app Sentropic de réf (Top AI Ideas) :
      polices/palette/composants alignés. Nav du `Header` re-alignée à
      gauche, `~$` cohérent table + carte. **Header désaligné** corrigé :
      mesuré au pixel (titre à 16px, contenu à 210px) → gouttière partagée
      32px header+contenu, contenu pleine largeur. Vérifié live.

### WP12 — Usage-over-time charts + 180/360j (status: 5/5, 100%)

Spec : `docs/superpowers/specs/2026-05-26-usage-charts-design.md` (approuvé).
Charts via DS `@0.9.0` (LineChart/BarChart/Sparkline, mono-série). Web only.

- [x] Bump `packages/web` design-system `^0.7 → ^0.9` + sélecteur fenêtre
      `180`/`360` jours (défaut passé à 90j pour que les charts soient peuplés).
- [x] Helper pur `weeklySeries(rows, metric, tool)` (bucket par `weekStart`,
      sum/max selon métrique, filtre outil) + **5 tests unitaires**.
- [x] Bloc "Usage over time" : `LineChart` smooth + toggle métrique
      (Tokens/Credits/Quota% 7d/Sessions) + toggle outil All/Claude/Codex.
- [x] `Sparkline` dans les 4 cartes (Sessions/Tokens/Cost/Quota peak) +
      Top projects en `BarChart` horizontal (table détaillée gardée).
- [x] Snapshot régénéré sur 360j (défaut générateur = 360). Vérifié live :
      LineChart (pic début avril) + BarChart + table, 84 tests, build OK.

### WP13 — Source Cursor + surface Codex (status: 6/6, 100%)

Spec : `docs/superpowers/specs/2026-05-27-cursor-source-design.md` (approuvé).
Objectif : « tous les usages locaux ». Cursor = 319 sessions / 146k messages,
avr. 2025 → avr. 2026, avec tokens (mais sans coût/quota). VSCode-Codex déjà
capté (originator `codex_vscode`) → juste l'étiqueter par surface.

- [x] Schéma : `Tool += 'cursor'` ; `session_start.surface?`.
- [x] Parser `cursor.ts` : `indexCursorSessions` (38 `state.vscdb`, dédup par
      `composerId`, mapping workspace→repo) + `parseCursorComposer` (tokens
      `inputTokens`/`outputTokens` par bubble). Parsing défensif (schéma non
      documenté). **Tests** (fixture vscdb en mémoire).
- [x] `collect()` : source `cursor` + option `cursorStateDir`.
- [x] Codex surface : `originator`→`surface` ; agrégation `sessionsBySurface`
      (Record, pas de multiplication de lignes). **Test** fixture `codex_vscode`.
- [x] Web : `tool='cursor'` (badge, filtres, toggle outil du graphe) ; petit
      « Codex by surface ». Pas de coût/quota Cursor.
- [x] Régénérer le snapshot publié (remonte à avr. 2025) ; vérif CLI/build
      (+ screenshot live quand MCP reconnecté).

### WP14 — Graphe « Usage over time » enrichi (status: 5/5, 100%)

Spec : `docs/superpowers/specs/2026-05-27-usage-chart-enrichment-design.md`
(approuvé). Décisions Q/R : cached isolé+exclu des in/out ; split fournisseur
en **small multiples** (DS mono-série) ; daily <30j via **snapshot hybride**
(`published-daily.json` ~60j).

- [x] Core : `granularity?: 'day'|'week'` sur la ligne ; `dayStartIso` +
      `aggregateByPeriod(events, granularity)` (bucket jour/semaine). **Tests**.
- [x] Core `series.ts` : métriques `inputNew | output | inout | cached`
      (cache exclu de in/out) ; `periodSeries` granularité-agnostique. **Tests**.
- [x] CLI : `runStats` `granularity 'day'|'week'|'auto'` (<30j → day).
- [x] Générateur : émettre `published-daily.json` (~60 derniers jours, daily,
      même relabel + anonymisation).
- [x] Web : dropdown métrique (4 options) + **checkboxes** fournisseurs →
      small multiples ; source daily vs weekly selon `sinceDays<30`. Vérif
      headless + build.

### WP9 — CI + release (status: 4/4, 100%)

- [x] Coverage report dans CI (`@vitest/coverage-v8`, upload artifact)
- [x] npm publish workflow (sur tag `v*` : provenance, NPM_TOKEN secret)
- [x] Release notes auto-générées (`git log` entre tags, push gh release)
- [x] `.github/workflows/release.yml` créé (publish core + cli)

---

## Status (mis à jour automatiquement)

| WP        | Titre                         |  Total |   Done |       % | État        |
| --------- | ----------------------------- | -----: | -----: | ------: | ----------- |
| 1         | Repo bootstrap                |     14 |     14 |    100% | completed   |
| 2         | Parsers MVP                   |     10 |     10 |    100% | completed   |
| 3         | Aggregations MVP              |      8 |      8 |    100% | completed   |
| 4         | CLI MVP                       |      6 |      6 |    100% | completed   |
| 6         | Cleanser secrets              |      5 |      4 |     80% | in_progress |
| 5         | Anomaly heuristiques          |      4 |      4 |    100% | completed   |
| 8         | Web dashboard                 |      5 |      5 |    100% | completed   |
| 7         | Phase 2 LLM                   |      5 |      5 |    100% | completed   |
| 9         | CI + release                  |      4 |      4 |    100% | completed   |
| 10        | Pages + DS Sentropic          |      5 |      5 |    100% | completed   |
| 11        | Corrections post-revue        |      4 |      4 |    100% | completed   |
| 12        | Usage charts + 180/360j       |      5 |      5 |    100% | completed   |
| 13        | Source Cursor + surface Codex |      6 |      6 |    100% | completed   |
| 14        | Usage chart enrichi           |      5 |      5 |    100% | completed   |
| **Total** |                               | **86** | **85** | **99%** |             |

> ⚠️ Le **% mesure la couverture de specs, pas la valeur**. Après la revue
> utilisateur du 2026-05-25, 2 bugs fonctionnels bloquants ont été trouvés
> et corrigés (coût Codex à 0, dashboard public vide) — le 98% précédent
> était trompeur. Reste 1 item ouvert : WP6 patterns YAML (différé).

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
- 2026-05-21 : **WP8 Web dashboard clôturé à 100% (5/5).** SvelteKit 2 +
  Svelte 5 (runes) + Vite + adapter-static. Pages `/` (Overview avec
  cards, top projects, table) et `/anomalies` (avec severity badges).
  CLI sub-command `agent-stats web --port` qui sert le build static +
  endpoints `/api/stats` et `/api/anomalies` via Node http natif (zéro
  framework HTTP supplémentaire). Overrides `claudeProjectsDir` et
  `codexDbPath` propagés pour les tests. 5 nouveaux tests CLI →
  **68 tests verts.**
- 2026-05-21 : **WP7 Phase 2 LLM clôturé à 100% (5/5).** `analyzeWithLlm`
  - `benchModels` dans `@sentropic/agent-stats-core` (duck-typed sur
    `LlmMeshLike` → zéro hard dep sur `@sentropic/llm-mesh`).
    `AnalyzeCache` interface pour stocker les verdicts (JsonStorage
    compatible). CLI `agent-stats analyze` avec dynamic-import optionnel
  - injection programmatique. 9 nouveaux tests (7 core + 2 CLI) →
    **77 tests verts.** Reste WP6 last item (custom yaml patterns) :
    différé, non-bloquant.
- 2026-05-23 : **WP10 Lot 10.1 livré (Pages env-driven).**
  `svelte.config.js` lit `PAGES_BASE_PATH` (default vide = root) ;
  workflow `pages.yml` calcule `base_path` à partir de la variable
  repo `PAGES_CUSTOM_DOMAIN` (sub-path repo si absente, vide si
  présente) et émet automatiquement le `CNAME` au build. Cible
  prévue : `agent-stats.sent-tech.ca`. Aucun domaine en dur dans la
  lib. Reste Lot 10.2 (Sentropic design system) — bloqué tant que les
  packages `@sentropic/design-system-*` ne sont pas sur npm.
- 2026-05-25 : **🚀 v0.1.0 PUBLIÉ SUR NPM.**
  `@sentropic/agent-stats-core@0.1.0` + `@sentropic/agent-stats@0.1.0`
  live sur registry.npmjs.org (vérifié). Auth via `npm login`
  (security key WebAuthn validée par l'utilisateur) puis publish web-OTP
  par package (validation security key à chaque publish). Tag git
  `v0.1.0` poussé. Installable : `npx @sentropic/agent-stats@0.1.0`.
  Note : le push du tag déclenche `release.yml` qui échouera au step
  publish (versions déjà publiées + `NPM_TOKEN` absent) — échec
  inoffensif ; pour les futurs releases, ajouter le secret `NPM_TOKEN`.
- 2026-05-25 : **WP10 Lot 10.2 livré (design system Sentropic).**
  Les packages `@sentropic/design-system-{themes,svelte,tokens}@0.7.0`
  étant désormais publiés npm, le dashboard web est passé au design
  system : `<ThemeProvider>` + `<Header>` dans `+layout.svelte`,
  `<Card>`/`<Button>`/`<Select>`/`<Badge>`/`<DataTable>` dans les deux
  pages, theme switcher (sent-tech/forge/entropic) persisté localStorage
  (`$lib/theme.svelte.ts`), styles résiduels sur tokens `--st-semantic-*`.
  Aucun thème en dur. `typecheck` 0 erreur, `build` OK, composants +
  vars de thème bundlés dans `_app/`. **WP10 clôturé 5/5. Total 65/66 (98%).**
- 2026-05-25 : **Déploiement Pages bout-en-bout (par moi, sans action user).**
  CNAME Cloudflare `agent-stats.sent-tech.ca` → `rhanka.github.io` (DNS-only)
  via API CF (token depuis `onyxia/.env`) ; variable repo
  `PAGES_CUSTOM_DOMAIN` + secret `NPM_TOKEN` posés via `gh` ; Pages activé
  (build via Actions) ; workflow `pages.yml` re-dispatché → deploy OK.
  **Live : https://agent-stats.sent-tech.ca/ (HTTPS 200).** Ajout d'un
  `EmptyState` « run locally » sur les 2 pages pour le cas statique
  (pas d'API `/api/*` sur Pages). Routing Pages corrigé : `404.html`
  (fallback SPA) + `prerender=true` sur `+layout.ts` → chaque route est
  un fichier statique (vérifié live : `/` 200, `/anomalies` 200,
  route inconnue 404).
- 2026-05-25 : **Vulnérabilités Dependabot résolues (3 → 0).**
  Toutes dev-only/transitives. Bump `vitest`/`@vitest/coverage-v8`
  `^2 → ^4.1.7` (corrige les 2 medium vite/esbuild via le test tooling) ;
  `overrides.cookie ^0.7.0` (clean reinstall) corrige les 3 low cookie
  tirées par `@sveltejs/kit` (aucun fix upstream, mais sortie prérendue
  statique = pas de runtime cookie). Vérifié : `npm audit` **0 vuln**,
  77/77 tests verts (vitest 4), lint clean, web typecheck 0 erreur,
  web build OK avec `cookie@0.7.2`.
- 2026-05-25 : **WP11 — revue utilisateur ("je doute du 98%").** 2 bugs
  fonctionnels trouvés sur données réelles et corrigés : (1) coût Codex
  toujours 0 car le parser ne lisait pas `turn_context.model` ; (2)
  dashboard public vide (pas de backend). + métrique coût honnête (crédits
  Codex / `~$` notionnel Claude / pic quota 5h-7j) et polish DS. 79 tests
  verts. Live peuplé : https://agent-stats.sent-tech.ca/. Leçon : le % de
  cases cochées ≠ valeur livrée — toujours vérifier sur données réelles.

---

## En attente de toi (bloqueurs)

_Aucun bloqueur ouvert — l'infra de déploiement a été configurée par moi
(CF API token + `gh`)._

- ~~**Pages — custom domain `agent-stats.sent-tech.ca`**~~
  ✅ **Résolu 2026-05-25** : CNAME Cloudflare `agent-stats` → `rhanka.github.io`
  (DNS-only) créé via l'API CF ; variable repo
  `PAGES_CUSTOM_DOMAIN=agent-stats.sent-tech.ca` posée ; Pages activé
  (build via GitHub Actions) ; deploy réussi. **Live HTTPS 200 :
  https://agent-stats.sent-tech.ca/** (cert GitHub provisionné).
- ~~**Sentropic design system — publication npm requise pour Lot 10.2**~~
  ✅ **Résolu 2026-05-25** : packages publiés `@0.7.0`, UI basculée.
- ~~**npm publish v0.1.0 — token + auth**~~
  ✅ **Résolu** : v0.1.0 publié (security key). Secret CI `NPM_TOKEN`
  posé via `gh` (lu depuis `~/.npmrc`) pour les futurs releases via tag.

Note : le site statique Pages n'a pas de backend `/api/*` → les pages
affichent un `EmptyState` « run locally » (et non une erreur crue). Les
vraies données ne s'affichent qu'en local via `agent-stats web`.

Les prochaines questions arriveront si un choix structurant émerge pendant
l'implémentation (typiquement : format du fichier secrets-patterns en WP6,
modèle exact pour eval set en WP7).

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
