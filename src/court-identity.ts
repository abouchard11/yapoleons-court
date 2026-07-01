import posthog from 'posthog-js';
import { StorageAdapter } from './storage-adapter';
import { API_BASE } from './config';

// Anonymous, mint-on-first-launch identity (MEM-04). Forked from the source
// engine's accessor + apiFetch shape, with the contact/billing/entitlement state
// removed: identity is anonymous from the first launch (no sign-up gate). The only
// client-held credential is the opaque bearer token.

// ── Private key constants (already in storage-adapter.ts KNOWN_KEYS) ──
const IDENTITY_PLAYER_ID = 'court.identity.player_id';
const IDENTITY_TOKEN = 'court.identity.token';

export interface CourtIdentity {
  player_id: string;
  token: string;
}

// ── Accessors ──

export function getToken(): string | null {
  return StorageAdapter.getItem(IDENTITY_TOKEN);
}

export function getPlayerId(): string | null {
  return StorageAdapter.getItem(IDENTITY_PLAYER_ID);
}

// ── PostHog identity (VAL-01) ──
//
// The single identify site. getPlayerId() is a SYNCHRONOUS storage read but the id is
// minted ASYNCHRONOUSLY (mintIdentity → POST /api/court-anon), and the only mint caller
// is RoundScreen's async mount effect — which runs AFTER main.tsx's module-load
// posthog.init(). So a main.tsx-ONLY identify is SKIPPED on a genuine first launch (the
// id is still null there) and the new-player cohort — the exact cohort VAL-01/D1 exists
// to measure — is never identified. FIX: call this from BOTH main.tsx (returning player,
// id already in storage at load) AND RoundScreen after ensureIdentity() resolves (first
// launch, id just minted).
//
// Idempotent + truthy-id-guarded: with person_profiles:'identified_only' set in main.tsx,
// D1/D7 cohorts stay empty until identify runs at the site where the id actually exists.
// A returning-player double-call is harmless (identify with the same id is a no-op). The
// person-props 2nd arg is DELIBERATELY omitted — no PII is ever attached to the opaque id
// (SAFE-03 / COPPA; the "never join PII to player_id" invariant).
export function identifyPlayer(): void {
  const id = getPlayerId();
  if (!id) return; // no identity minted yet → skip silently (first-launch main.tsx path)
  try {
    posthog.identify(id); // NO person-props — the id stays opaque (no PII, SAFE-03).
  } catch { /* PostHog send failure is non-critical (mirrors trackEvent) */ }
}

// ── Mint (replaces the source engine's sign-up register) ──

// POSTs /api/court-anon with NO PII body (anonymous by construction), persists
// the returned { player_id, token }, and returns it.
export async function mintIdentity(): Promise<CourtIdentity> {
  const res = await fetch(`${API_BASE}/api/court-anon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Identity mint failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  StorageAdapter.setItem(IDENTITY_PLAYER_ID, data.player_id);
  StorageAdapter.setItem(IDENTITY_TOKEN, data.token);
  return { player_id: data.player_id, token: data.token };
}

// Reuse an existing local identity if present; otherwise mint a fresh one.
// Idempotent: a second call with a token already stored does NOT mint again
// (no second identity — the LOOP-05 / replay-lock substrate depends on this).
export async function ensureIdentity(): Promise<CourtIdentity> {
  const token = getToken();
  const playerId = getPlayerId();
  if (token && playerId) {
    return { player_id: playerId, token };
  }
  return mintIdentity();
}

// ── Authenticated fetch ──

export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}
