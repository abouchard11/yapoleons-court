import { Capacitor } from '@capacitor/core';

// Lifted from the fork source (the SITE_URL / API_BASE consts).
// withShareUtm is intentionally dropped here — share-card attribution is Phase 2.
export const SITE_URL = 'https://yapoleonscourt.com';

// On native, relative /api/* paths hit Capacitor's local file handler (no server).
// Prefix with the production origin so requests reach the Vercel serverless functions.
export const API_BASE = Capacitor.isNativePlatform() ? SITE_URL : '';
