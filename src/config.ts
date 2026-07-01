import { Capacitor } from '@capacitor/core';

// Lifted from the fork source (the SITE_URL / API_BASE consts).
// withShareUtm is intentionally dropped here — share-card attribution is Phase 2.
export const SITE_URL = 'https://court.yapoleon.com';

// On native, relative /api/* paths hit Capacitor's local file handler (no server).
// Prefix with the production origin so requests reach the Vercel serverless functions.
export const API_BASE = Capacitor.isNativePlatform() ? SITE_URL : '';

// VAL-04: the client-side turn cap (LOOP-02) as a flag/config value. The VALUE STAYS 3 —
// this is reversibility, not a behaviour change. If a live turn-count trigger ever fires
// (turn-count gut-check, 2026-06-18), a reactive re-cal flips VITE_MAX_TURNS instead of a
// code edit. The SERVER caps (api/court-record-round.js MAX_TURNS, api/court-judge.js
// MAX_PRIOR) stay HARDCODED safety clamps (RESEARCH A5 — the client is the tunable, the
// server clamps). Invalid/absent env → 3 (Number('') || 3 === 3; NaN || 3 === 3).
export const MAX_TURNS = Number(import.meta.env.VITE_MAX_TURNS) || 3;
