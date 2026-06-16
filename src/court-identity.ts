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
