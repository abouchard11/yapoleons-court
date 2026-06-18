import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

// Forked whole from the fork source. The ONLY change is KNOWN_KEYS: the legacy
// per-app keys are replaced with the court.* keys (RESEARCH §A, PATTERNS Pattern 5).
// The Capacitor-Preferences/localStorage/cache logic is untouched.
export const KNOWN_KEYS = [
  'court.identity.player_id',
  'court.identity.token',
  'court.round.v1',
  'court.appearance',
  'court.onboarding.seen.v1',
] as const;

const cache = new Map<string, string | null>();
let _initialized = false;

export const StorageAdapter = {
  async init(): Promise<void> {
    if (_initialized) return;
    if (Capacitor.isNativePlatform()) {
      try {
        const results = await Promise.all(
          KNOWN_KEYS.map(key =>
            Preferences.get({ key }).then(r => ({ key, value: r.value }))
          )
        );
        for (const { key, value } of results) {
          cache.set(key, value);
        }
      } catch {
        // Fallback to localStorage if Preferences fails (T-07-05)
        for (const key of KNOWN_KEYS) {
          try { cache.set(key, localStorage.getItem(key)); }
          catch { cache.set(key, null); }
        }
      }
    } else {
      for (const key of KNOWN_KEYS) {
        try { cache.set(key, localStorage.getItem(key)); }
        catch { cache.set(key, null); }
      }
    }
    _initialized = true;
  },

  getItem(key: string): string | null {
    if (cache.has(key)) return cache.get(key) ?? null;
    // Dynamic keys (e.g. court.round.{day}) aren't preloaded — fall through to localStorage
    try { return localStorage.getItem(key); } catch { return null; }
  },

  setItem(key: string, value: string): void {
    cache.set(key, value);
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
    if (Capacitor.isNativePlatform()) {
      Preferences.set({ key, value }).catch(() => { /* localStorage is fallback */ });
    }
  },

  removeItem(key: string): void {
    cache.set(key, null);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    if (Capacitor.isNativePlatform()) {
      Preferences.remove({ key }).catch(() => { /* ignore */ });
    }
  },

  // Keep cache coherent when another tab writes a known key and this tab
  // receives a `storage` event with the new value.
  syncExternalChange(key: string, value: string | null): void {
    cache.set(key, value);
  },
};

export function _resetForTesting(): void {
  cache.clear();
  _initialized = false;
}
