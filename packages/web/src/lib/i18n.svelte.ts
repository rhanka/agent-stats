import { browser } from '$app/environment';

export type Lang = 'en' | 'fr';

const STRINGS = {
  en: {
    nav_overview: 'Overview',
    nav_anomalies: 'Anomalies',
    tagline: 'Claude Code + Codex usage',
    refresh: 'Refresh',
    window_days: '{n} days',
    overview_title: 'Overview — last {n} days',
    anomalies_title: 'Anomalies — last {n} days',
    sessions: 'Sessions',
    turns: 'Turns',
    input_tokens: 'Input tokens',
    output_tokens: 'Output tokens',
    cache_hit: '{p}% cache hit',
    estimated_cost: 'Estimated cost',
    cost_note: 'Codex = credits · Claude ~$ notional (flat-rate Max)',
    codex_quota_peak: 'Codex quota peak',
    quota_sub: '7-day window · 5h peak {p}%',
    usage_over_time: 'Usage over time',
    metric_inputNew: 'Input (new)',
    metric_output: 'Output',
    metric_inout: 'In + Out',
    metric_cached: 'Cached (read)',
    metric_credits: 'Codex credits',
    metric_quota: 'Quota % (7d)',
    metric_sessions: 'Sessions',
    chart_hint: '{metric} per {grain} · cached read is isolated (excluded from In+Out).',
    per_day: 'day',
    per_week: 'week',
    top_projects: 'Top projects',
    all_aggregations: 'All aggregations ({n} rows)',
    col_project: 'Project',
    col_sessions: 'Sessions',
    col_tokens: 'Tokens (in+out)',
    col_week: 'Week',
    col_tool: 'Tool',
    col_model: 'Model',
    col_sess: 'Sess',
    col_turns: 'Turns',
    col_in: 'In',
    col_out: 'Out',
    col_cost: 'Cost',
    col_severity: 'Severity',
    col_type: 'Type',
    col_session: 'Session',
    col_evidence: 'Evidence',
    loading: 'Loading…',
    no_data_title: 'No live data',
    published_title: 'Published snapshot — real usage',
    published_msg:
      "The maintainer's own Claude Code + Codex usage, computed locally and committed (projects link to their public git repos){at}. Run `npx @sentropic/agent-stats web` for your own.",
    generated: '. Generated {d}',
    no_anomalies: 'No anomalies detected.',
    no_data_window: 'No data in this window.',
  },
  fr: {
    nav_overview: 'Aperçu',
    nav_anomalies: 'Anomalies',
    tagline: 'Usage Claude Code + Codex',
    refresh: 'Rafraîchir',
    window_days: '{n} jours',
    overview_title: 'Aperçu — {n} derniers jours',
    anomalies_title: 'Anomalies — {n} derniers jours',
    sessions: 'Sessions',
    turns: 'Tours',
    input_tokens: "Tokens d'entrée",
    output_tokens: 'Tokens de sortie',
    cache_hit: '{p}% cache',
    estimated_cost: 'Coût estimé',
    cost_note: 'Codex = crédits · Claude ~$ notionnel (forfait Max)',
    codex_quota_peak: 'Pic quota Codex',
    quota_sub: 'fenêtre 7 j · pic 5 h {p}%',
    usage_over_time: 'Usage dans le temps',
    metric_inputNew: 'Entrée (nouveau)',
    metric_output: 'Sortie',
    metric_inout: 'Entrée + Sortie',
    metric_cached: 'Cache (lecture)',
    metric_credits: 'Crédits Codex',
    metric_quota: 'Quota % (7 j)',
    metric_sessions: 'Sessions',
    chart_hint: '{metric} par {grain} · le cache (lecture) est isolé (exclu de Entrée+Sortie).',
    per_day: 'jour',
    per_week: 'semaine',
    top_projects: 'Top projets',
    all_aggregations: 'Toutes les agrégations ({n} lignes)',
    col_project: 'Projet',
    col_sessions: 'Sessions',
    col_tokens: 'Tokens (e+s)',
    col_week: 'Semaine',
    col_tool: 'Outil',
    col_model: 'Modèle',
    col_sess: 'Sess.',
    col_turns: 'Tours',
    col_in: 'Entrée',
    col_out: 'Sortie',
    col_cost: 'Coût',
    col_severity: 'Sévérité',
    col_type: 'Type',
    col_session: 'Session',
    col_evidence: 'Preuve',
    loading: 'Chargement…',
    no_data_title: 'Pas de données live',
    published_title: 'Snapshot publié — usage réel',
    published_msg:
      "L'usage Claude Code + Codex du mainteneur, calculé en local et commité (les projets pointent vers leurs dépôts git publics){at}. Lance `npx @sentropic/agent-stats web` pour les tiens.",
    generated: '. Généré le {d}',
    no_anomalies: 'Aucune anomalie détectée.',
    no_data_window: 'Aucune donnée sur cette fenêtre.',
  },
} as const;

export type StringKey = keyof (typeof STRINGS)['en'];

const STORAGE_KEY = 'agent-stats:lang';

function initialLang(): Lang {
  if (browser) {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'fr' || saved === 'en') return saved;
    if (navigator.language?.toLowerCase().startsWith('fr')) return 'fr';
  }
  return 'en';
}

class I18n {
  lang = $state<Lang>(initialLang());

  set(l: Lang): void {
    this.lang = l;
    if (browser) window.localStorage.setItem(STORAGE_KEY, l);
  }

  /** Translate a key, interpolating {placeholders}. */
  t(key: StringKey, vars: Record<string, string | number> = {}): string {
    const dict = STRINGS[this.lang] ?? STRINGS.en;
    let s: string = dict[key] ?? STRINGS.en[key] ?? key;
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  }
}

export const i18n = new I18n();
