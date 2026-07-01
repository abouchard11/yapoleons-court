// ============================================================================
// SAFE-02 (Plan 04-02) — the judgeReply moderation BRIDGE.
//
// A red-line submission comes back from /api/court-judge as a 200 whose body is
// NOT a JudgeResult but `{ code: 'moderation_flagged', category }`. WITHOUT the
// bridge, that 200 falls through to parseJudgeResult and surfaces as a GENERIC,
// code-less JudgeError ("Judge result missing axisScores") — indistinguishable
// from a real parse failure, so RoundScreen would render the generic error state
// instead of the in-voice brush-off.
//
// This suite proves the bridge:
//   * a mocked moderation 200 → judgeReply REJECTS with a JudgeError carrying
//     code === 'moderation_flagged' + the category (isModerationFlag(err) true),
//     NOT a generic parse error;
//   * the moderation rejection is NOT retried (deterministic — one fetch only);
//   * a normal JudgeResult 200 still parses (the bridge does not disturb the
//     happy path).
// ============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Fixed API_BASE so the fetch URL is stable.
vi.mock('./config', () => ({ API_BASE: '' }));
// Identity accessor — a token is optional for the judge call; return null.
vi.mock('./court-identity', () => ({ getToken: () => null }));
// Silence the analytics bridge side effects (posthog / capacitor / gtag).
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({ logEvent: vi.fn(), isConfigured: vi.fn() }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { judgeReply, JudgeError, isModerationFlag, MODERATION_FLAGGED_CODE } from './gemini-client';
import type { DemandRecord } from './demands';

const DEMAND = {
  scene: 'The Emperor demands a compliment worthy of his portrait.',
  axisWeights: { wit: 1, specificity: 1, audacity: 1, economy: 1, flattery: 1 },
  rubricVersion: 'fairfight-v2',
} as unknown as DemandRecord;

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('judgeReply — SAFE-02 moderation bridge', () => {
  it('surfaces a moderation 200 as a moderation-tagged JudgeError (not a generic parse error)', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { code: MODERATION_FLAGGED_CODE, category: 'slur_hate' }),
    );

    await expect(judgeReply(DEMAND, 'a red-line reply')).rejects.toSatisfy((err: unknown) => {
      // Distinguishable: the guard the client branches on is true...
      expect(isModerationFlag(err)).toBe(true);
      // ...and it is NOT the generic code-less parse error.
      const je = err as JudgeError;
      expect(je).toBeInstanceOf(JudgeError);
      expect(je.code).toBe(MODERATION_FLAGGED_CODE);
      expect(je.category).toBe('slur_hate');
      expect(je.message).not.toMatch(/axisScores/i);
      return true;
    });
  });

  it('carries the category through (threat) and is a distinct signal from a generic JudgeError', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { code: MODERATION_FLAGGED_CODE, category: 'threat' }),
    );

    let caught: unknown;
    try {
      await judgeReply(DEMAND, 'i will kill you');
    } catch (err) {
      caught = err;
    }
    expect(isModerationFlag(caught)).toBe(true);
    expect((caught as JudgeError).category).toBe('threat');

    // A GENERIC code-less JudgeError must NOT satisfy the moderation guard.
    expect(isModerationFlag(new JudgeError('Judge result missing axisScores'))).toBe(false);
  });

  it('does NOT retry a moderation flag (deterministic — exactly one fetch)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, { code: MODERATION_FLAGGED_CODE, category: 'sexual_minor' }),
    );

    await expect(judgeReply(DEMAND, 'a red-line reply', [], { maxAttempts: 3 })).rejects.toBeInstanceOf(JudgeError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('still parses a normal JudgeResult 200 (bridge does not disturb the happy path)', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        axisScores: { wit: 0.8, specificity: 0.7, audacity: 0.6, economy: 0.5, flattery: 0.4 },
        favorDelta: 24,
        dominantAxis: 'wit',
        reaction: 'A passable turn. The Emperor is briefly amused.',
      }),
    );

    const result = await judgeReply(DEMAND, 'a witty, clean reply');
    expect(result.favorDelta).toBe(24);
    expect(result.dominantAxis).toBe('wit');
    expect(result.reaction).toContain('amused');
  });
});
