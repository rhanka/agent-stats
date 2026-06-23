#!/usr/bin/env node
/**
 * Facture coûts par PROJET (un projet = un ou plusieurs repos), attribution par
 * REPO (git remote / dossier repo), pas par cwd brut — capture les sessions
 * déléguées/headless (worktree, Pod, cwd vide). Node uniquement (jamais Python).
 * S'appuie sur @sentropic/agent-stats-core collect() (events bruts + SessionMeta).
 *
 * Méthode (recette, identique au doc immo) :
 *  - tokens immo par fenêtre, claude (in+cached+cacheWrite+out) / codex (in+cached+out)
 *  - capacité = pic 7j glissant des tokens GLOBAUX (tous projets) par fournisseur, sur SINCE..UNTIL
 *  - prorata réel = immo_tokens / (capacité_pic7j × jours/7) × (forfait_mensuel × jours/30)
 *  - facturable = prorata × (1 + marge)
 *
 *   REPOS=geo,geo-quebec SINCE=2026-04-22 UNTIL=2026-06-23 \
 *   WINDOWS=A:2026-05-24..2026-06-14,B:2026-06-15..2026-06-22 \
 *     node packages/web/scripts/project-costs.mjs
 */
import { collect } from '@sentropic/agent-stats-core';

const REPOS = (process.env.REPOS || 'radar-immobilier').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const SINCE = new Date((process.env.SINCE || '2026-04-22') + 'T00:00:00Z');
const UNTIL = new Date((process.env.UNTIL || '2026-06-23') + 'T00:00:00Z');
const CLAUDE_SEATS = Number(process.env.CLAUDE_SEATS || 2);
const CODEX_SEATS = Number(process.env.CODEX_SEATS || 1);
const SEAT_USD = Number(process.env.SEAT_USD || 200);
const MARGIN = Number(process.env.MARGIN || 0.15);
const USDCAD = Number(process.env.USDCAD || 1.37);
// fenêtres "label:start..end" (end inclus, par jour)
const WINDOWS = (process.env.WINDOWS || 'A:2026-05-24..2026-06-14,B:2026-06-15..2026-06-22,cumul:2026-05-24..2026-06-22')
  .split(',').map(w => { const [lab, range] = w.split(':'); const [s, e] = range.split('..'); return { lab, s, e }; });

// repo name from a /…/src/<repo>[/…] path, or from a git remote url
const repoFromCwd = (cwd) => { const m = (cwd || '').match(/\/src\/([^/]+)/); return m ? m[1].toLowerCase() : null; };
const repoFromUrl = (url) => { const m = (url || '').match(/\/([^/]+?)(?:\.git)?\/?$/); return m ? m[1].toLowerCase() : null; };
const inSet = (name) => name != null && REPOS.includes(name);

const tot = (u) => (u.newInputTokens||0)+(u.cachedInputTokens||0)+(u.cacheWriteTokens||0)+(u.outputTokens||0);
const totCx = (u) => (u.newInputTokens||0)+(u.cachedInputTokens||0)+(u.outputTokens||0);
const day = (ts) => ts.slice(0, 10);

const meta = new Map(); // sessionId -> {repoUrl, cwd, sub}
const dayGlobal = { claude: {}, codex: {} };
const dayProj = { claude: {}, codex: {} };
const dayTimeSec = {}; // jour -> secondes d'attention humaine (projet, sessions non-subagent)
const src = { repoUrl_only: 0, cwd: 0, both: 0 };
const projSessions = new Set();
// temps forfaitaire par message humain (modèle du doc immo) : commande / substantiel / UAT long
const msgSeconds = (len) => (len <= 40 ? 7 : len <= 500 ? 25 : 25 * 2.5);

function projMatch(m, evCwd) { return inSet(repoFromCwd(m.cwd || evCwd)) || inSet(repoFromUrl(m.repoUrl)); }

for await (const ev of collect({ since: SINCE, until: UNTIL, sources: { claude: true, codex: true, cursor: false, gemini: false } })) {
  if (ev.kind === 'session_start') { meta.set(ev.sessionId, { repoUrl: ev.repoUrl, cwd: ev.projectCwd, sub: ev.isSubagent, surf: ev.surface }); continue; }
  const m = meta.get(ev.sessionId) || {};
  if (ev.kind === 'user_prompt') {
    // attention humaine = prompts d'une session INTERACTIVE (surface cli/vscode/cursor),
    // NON-subagent, du projet. Exclut headless `exec` (délégué/scripté) + subagents +
    // sessions sans session_start capturé (surface inconnue) — qui polluaient le compte.
    const human = m.surf === 'cli' || m.surf === 'vscode' || m.surf === 'cursor';
    if (human && !m.sub && projMatch(m, ev.projectCwd)) dayTimeSec[day(ev.ts)] = (dayTimeSec[day(ev.ts)] || 0) + msgSeconds(ev.textLength || 0);
    continue;
  }
  if (ev.kind !== 'turn') continue;
  const prov = ev.tool === 'codex' ? 'codex' : ev.tool === 'claude' ? 'claude' : null;
  if (!prov) continue;
  const t = prov === 'codex' ? totCx(ev.usage || {}) : tot(ev.usage || {});
  const d = day(ev.ts);
  dayGlobal[prov][d] = (dayGlobal[prov][d] || 0) + t;
  const byCwd = inSet(repoFromCwd(m.cwd || ev.projectCwd));
  const byRepo = inSet(repoFromUrl(m.repoUrl));
  if (byCwd || byRepo) {
    dayProj[prov][d] = (dayProj[prov][d] || 0) + t;
    projSessions.add(ev.sessionId);
    if (byCwd && byRepo) src.both += t; else if (byRepo) src.repoUrl_only += t; else src.cwd += t;
  }
}

const sumRange = (map, s, e) => { let x = 0; for (const [d, v] of Object.entries(map)) if (d >= s && d <= e) x += v; return x; };
function peak7(map) {
  const days = []; for (let dt = new Date(SINCE); dt < UNTIL; dt.setUTCDate(dt.getUTCDate() + 1)) days.push(dt.toISOString().slice(0, 10));
  let best = 0; for (let i = 0; i < days.length; i++) { let s = 0; for (let j = i; j < i + 7 && j < days.length; j++) s += map[days[j]] || 0; if (s > best) best = s; } return best;
}
const cap = { claude: peak7(dayGlobal.claude), codex: peak7(dayGlobal.codex) };
const daysBetween = (s, e) => Math.round((new Date(e + 'T00:00:00Z') - new Date(s + 'T00:00:00Z')) / 86400000) + 1;

const f = (n) => (n / 1e9).toFixed(2) + 'Md';
console.error(`PROJET repos=[${REPOS}] | attribution: cwd=${f(src.cwd)} both=${f(src.both)} repoUrl_seul(récupéré)=${f(src.repoUrl_only)} | sessions=${projSessions.size}`);
console.error(`capacité pic7j (global): claude=${f(cap.claude)} codex=${f(cap.codex)}`);
const result = { repos: REPOS, capacity_peak7d: cap, attribution: src, sessions: projSessions.size, windows: [] };
for (const w of WINDOWS) {
  const days = daysBetween(w.s, w.e);
  const ic = sumRange(dayProj.claude, w.s, w.e), ix = sumRange(dayProj.codex, w.s, w.e);
  const feeC = CLAUDE_SEATS * SEAT_USD * days / 30, feeX = CODEX_SEATS * SEAT_USD * days / 30;
  const capC = cap.claude * days / 7, capX = cap.codex * days / 7;
  const prC = capC ? ic / capC * feeC : 0, prX = capX ? ix / capX * feeX : 0, prTot = prC + prX;
  const bill = prTot * (1 + MARGIN);
  const hours = sumRange(dayTimeSec, w.s, w.e) / 3600;
  result.windows.push({ ...w, days, immo_claude: ic, immo_codex: ix, shareC: capC ? ic / capC : 0, shareX: capX ? ix / capX : 0, prorataUSD: prTot, prorataCAD: prTot * USDCAD, facturableCAD: bill * USDCAD, attentionHours: hours });
  console.error(`[${w.lab}] ${w.s}->${w.e} (${days}j): claude=${f(ic)} (${(100*(capC?ic/capC:0)).toFixed(1)}%) codex=${f(ix)} (${(100*(capX?ix/capX:0)).toFixed(2)}%) | prorata ${(prTot*USDCAD).toFixed(2)} CAD | FACTURABLE ${(bill*USDCAD).toFixed(2)} CAD | temps ~${hours.toFixed(1)}h`);
}
process.stdout.write(JSON.stringify(result, null, 1));
