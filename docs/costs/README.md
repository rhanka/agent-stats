# Costs par projet — job réutilisable

Facture coûts d'un projet (1+ repos) à partir des sessions réelles claude/codex, **attribution par repo** (capture le travail délégué/headless/flotte), prorata des abonnements à la capacité, temps d'attention, en Node.

## Lancer

```bash
# immo
REPOS=radar-immobilier node packages/web/scripts/project-costs.mjs
# geo (= geo + geo-quebec, un seul projet)
REPOS=geo,geo-quebec node packages/web/scripts/project-costs.mjs
```

Paramètres (env) : `REPOS` (noms de repos, virgule), `SINCE`/`UNTIL` (ISO, fenêtre de capacité), `WINDOWS` (`label:start..end,…`, jours inclus), `CLAUDE_SEATS`/`CODEX_SEATS`/`SEAT_USD`/`MARGIN`/`USDCAD`.

Sortie : résumé lisible sur stderr, JSON complet sur stdout. Méthode détaillée + dernières factures : `costs-<projet>-<date>.md` dans ce dossier.

> Recette : voir [costs-immo-2026-06-22.md](./costs-immo-2026-06-22.md). Jamais de Python — tout est Node.
