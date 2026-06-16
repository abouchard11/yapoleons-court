import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory StorageAdapter mock — isolates the identity logic from Capacitor.
const store: Record<string, string | null> = {};
vi.mock('./storage-adapter', () => ({
  StorageAdapter: {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
  },
}));

// Fixed API_BASE so apiFetch's URL is assertable.
vi.mock('./config', () => ({ API_BASE: '' }));

// Mock fetch.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  getToken,
  getPlayerId,
  mintIdentity,
  ensureIdentity,
  apiFetch,
} from './court-identity';

const PLAYER_ID_KEY = 'court.identity.player_id';
const TOKEN_KEY = 'court.identity.token';

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mockFetch.mockReset();
});

function mintResponse(player_id: string, token: string) {
  return {
    ok: true,
    status: 201,
    json: () => Promise.resolve({ player_id, token }),
  } as unknown as Response;
}

describe('court-identity', () => {
  it('getToken() returns null when no token is stored', () => {
    expect(getToken()).toBeNull();
    expect(getPlayerId()).toBeNull();
  });

  it('ensureIdentity() with no local token POSTs /api/court-anon once and persists identity', async () => {
    mockFetch.mockResolvedValueOnce(mintResponse('p-1', 't-1'));

    const result = await ensureIdentity();

    expect(result).toEqual({ player_id: 'p-1', token: 't-1' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/court-anon');
    expect(opts.method).toBe('POST');
    // Persisted to the court.identity.* keys → getToken now returns it.
    expect(getToken()).toBe('t-1');
    expect(getPlayerId()).toBe('p-1');
    expect(store[TOKEN_KEY]).toBe('t-1');
    expect(store[PLAYER_ID_KEY]).toBe('p-1');
  });

  it('ensureIdentity() reuses an existing local token and does NOT mint a second identity', async () => {
    // Seed an existing identity.
    store[PLAYER_ID_KEY] = 'p-existing';
    store[TOKEN_KEY] = 't-existing';

    const result = await ensureIdentity();

    expect(result).toEqual({ player_id: 'p-existing', token: 't-existing' });
    // The critical assertion: NO second mint.
    expect(mockFetch).toHaveBeenCalledTimes(0);
    expect(getToken()).toBe('t-existing');
  });

  it('mintIdentity() POSTs with no email/username body and persists the returned identity', async () => {
    mockFetch.mockResolvedValueOnce(mintResponse('p-2', 't-2'));

    const result = await mintIdentity();

    expect(result).toEqual({ player_id: 'p-2', token: 't-2' });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/court-anon');
    expect(opts.method).toBe('POST');
    // No PII body — either no body at all, or an empty object.
    if (opts.body != null) {
      const parsed = JSON.parse(opts.body);
      expect(parsed.email).toBeUndefined();
      expect(parsed.username).toBeUndefined();
    }
    expect(getToken()).toBe('t-2');
  });

  it('apiFetch(path) sets Authorization: Bearer <token> from the stored token', async () => {
    store[TOKEN_KEY] = 't-bearer';
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);

    await apiFetch('/api/court-can-play', { method: 'POST' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/court-can-play');
    const headers = new Headers(opts.headers);
    expect(headers.get('Authorization')).toBe('Bearer t-bearer');
    expect(opts.method).toBe('POST');
  });
});
