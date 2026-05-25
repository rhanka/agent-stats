import { browser } from '$app/environment';
import {
  sentTechTheme,
  forgeTheme,
  entropicTheme,
  type TenantTheme,
} from '@sentropic/design-system-themes';

/** Available Sentropic tenant themes, keyed by their stable id. */
export const THEMES: Record<string, TenantTheme> = {
  'sent-tech': sentTechTheme,
  forge: forgeTheme,
  entropic: entropicTheme,
};

const STORAGE_KEY = 'agent-stats:theme';
const DEFAULT_ID = 'sent-tech';

function initialId(): string {
  if (browser) {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && saved in THEMES) return saved;
  }
  return DEFAULT_ID;
}

/** Reactive, localStorage-persisted theme selection shared across routes. */
class ThemeState {
  id = $state(initialId());

  get theme(): TenantTheme {
    return THEMES[this.id] ?? sentTechTheme;
  }

  set(id: string): void {
    if (!(id in THEMES)) return;
    this.id = id;
    if (browser) window.localStorage.setItem(STORAGE_KEY, id);
  }
}

export const themeState = new ThemeState();
