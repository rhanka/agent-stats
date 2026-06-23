# Costs — radar-immobilier (immo) — 2026-06-22

> **Généré** : 2026-06-23. **Projet** : radar-immobilier. **Change** : USD→CAD 1,37 · EUR→CAD 1,617.
> Chiffres **mesurés** (sessions réelles `~/.claude` + `~/.codex`) sauf mention _inféré_.

## Recette (méthode) — reproductible

Job Node : [`packages/web/scripts/project-costs.mjs`](../../packages/web/scripts/project-costs.mjs) (s'appuie sur `@sentropic/agent-stats-core.collect()`).

```
REPOS=radar-immobilier SINCE=2026-04-22 UNTIL=2026-06-23 \
  node packages/web/scripts/project-costs.mjs
```

- **Attribution par REPO** (git remote + dossier repo), PAS par cwd brut → capture les sessions **déléguées/headless/flotte** (worktree, Pod, cwd vide). C'est la correction clé : le `stats` agrégé mis-bucketait ces sessions (donnait un faux « 0 » sur certaines fenêtres).
- **Tokens** : claude = newInput + cachedInput + cacheWrite + output ; codex = newInput + cachedInput + output.
- **Capacité** = pic de tokens sur **fenêtre glissante 7 j** des tokens GLOBAUX (tous projets) par fournisseur, mesuré sur 2 mois (≈ plafond du plan poussé).
- **Prorata réel (coût facturé)** = `tokens_projet ÷ (capacité_pic7j × jours/7) × (forfait_mensuel × jours/30)`. Forfaits : **2 Claude Max ×20 @ 200 $US** + **1 ChatGPT Pro @ 200 $US**.
- **Marge facturable** : ×1,15.
- **Temps (attention humaine)** : forfait/message des sessions **interactives** (`surface` cli/vscode/cursor, **non-subagent**) ; commande ≤40c = 7 s, ≤500c = 25 s, UAT >500c = 25 s ×2,5. Exclut headless `exec`, subagents, et [h2a]/flotte.
- **Compute SCW** : run-rate immo ≈ 4,9 CAD/mois (cf. [`docs/scw/infra.md`](../scw/infra.md), base 2026-06-14 : compute usage-réel ~1,5 %, block 10 Gi, S3 vide, RWX 0), proraté aux jours.

## Capacité mesurée (pic 7 j, global, 2 mois)
Claude **23,4 Md/sem** · Codex **35,4 Md/sem**.

## Facture (LLM prorata + SCW + temps)

| Période | claude (part) | codex (part) | prorata LLM | **LLM facturable** | SCW | **Total facturable** | temps interactif |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A — 05-24→06-14 (22 j) | 7,34 Md (10,0 %) | 0,45 Md (0,41 %) | 40,88 CAD | **47,01 CAD** | ~3,6 CAD | **~50,6 CAD** | ~0,4 h |
| **B — depuis le 14 (06-15→06-22, 8 j)** | 2,53 Md (9,4 %) | 0,83 Md (2,05 %) | 15,30 CAD | **17,60 CAD** | ~1,3 CAD | **~18,9 CAD** | ~0,8 h |
| Cumul — 05-24→06-22 (30 j) | 9,87 Md (9,8 %) | 1,28 Md (0,84 %) | 56,18 CAD | **64,61 CAD** | ~4,9 CAD | **~69,5 CAD** | ~1,2 h |

## Notes / réserves
- **A reproduit la facture du 14/06** (47 CAD vs 49,52 ; part claude 10,0 % vs 10,5 %) → méthode validée. Le « +28 % » d'une tentative intermédiaire venait du `stats` **agrégé** (sur-comptait) ; le `collect()` brut est juste.
- **Temps = plancher interactif** : attention DIRECTE tapée en session cli sur le repo. Immo a surtout tourné en **délégué/flotte** cette semaine (d'où temps tapé faible) ; la **supervision** du travail délégué n'est pas attribuée ici. À compléter via le tracking de charge si besoin.
- SCW : extrapolé du run-rate du 14/06 ; ré-inspecter `scw`/`kubectl` si l'infra a changé.
- USD→CAD 1,37 _(inféré)_.
