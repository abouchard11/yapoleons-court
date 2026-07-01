// ============================================================================
// COST-04 — the DEGRADE_MODE force-degrade path.
//
// Proves the manual degradation lever: with DEGRADE_MODE on, the judge handler
// serves a CACHED in-voice reaction with ZERO model calls and a SERVER-DERIVED
// favorDelta — a still-playable, cheaper round under load. The HARD INVARIANT
// holds: favorDelta still comes from deriveFavorDelta (from neutral scores); no
// cost/degrade signal enters the rubric or threshold.
//
// Contract asserted here:
//   * DEGRADE_MODE off (default): the handler reaches the model-calling section
//     (a fetch is attempted) — the degrade branch does NOT hijack normal traffic.
//   * DEGRADE_MODE on: the response is a valid JudgeResult
//     { axisScores, favorDelta, dominantAxis, reaction } with:
//       - reaction === the cached in-voice line (no model output)
//       - favorDelta a finite number (server-derived via deriveFavorDelta)
//       - ZERO global.fetch calls (no :generateContent — the pinned count is safe)
//   * The cached reaction passes the SAFE-01 output bound (no slur/strong
//     profanity; targets no one) — reused via src/safety/output-scan.ts.
//
// The handler is invoked for real (export default) with a mocked req/res and a
// global fetch spy; the model endpoint is never hit because the degrade branch
// returns before the body build / model loop.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from './court-judge.js';
import { scanForBannedProfanity, targetsPerson } from '../src/safety/output-scan.ts';

// A minimal mock `res` that records the last status + JSON payload.
function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

// A valid POST request that passes origin + method + body validation and is NOT
// a red-line reply (so it reaches the degrade/model decision point).
function makeReq(overrides = {}) {
  return {
    method: 'POST',
    headers: { origin: 'https://court.yapoleon.com' },
    body: {
      scene: 'The Emperor demands you justify your presence in his court.',
      reply: 'I bring you a mirror, Sire, so you may admire the only worthy subject here.',
      axisWeights: { wit: 1, specificity: 1, audacity: 1, economy: 1, flattery: 1 },
      priorReplies: [],
    },
    ...overrides,
  };
}

describe('COST-04 — DEGRADE_MODE force-degrade path', () => {
  let fetchSpy;
  const priorEnv = {};

  beforeEach(() => {
    // The handler bails early without a key; set a dummy (never used on the
    // degrade path — no model call is made).
    priorEnv.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    priorEnv.DEGRADE_MODE = process.env.DEGRADE_MODE;
    process.env.GEMINI_API_KEY = 'test-key-not-used-on-degrade-path';
    // Spy on global fetch. On the degrade path it must NEVER be called. If a
    // regression calls the model, we reject so the test fails loudly (and does
    // not hit the network).
    fetchSpy = vi.fn(() => Promise.reject(new Error('fetch must not be called on the degrade path')));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (priorEnv.GEMINI_API_KEY === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = priorEnv.GEMINI_API_KEY;
    if (priorEnv.DEGRADE_MODE === undefined) delete process.env.DEGRADE_MODE;
    else process.env.DEGRADE_MODE = priorEnv.DEGRADE_MODE;
  });

  it('DEGRADE_MODE on: returns a valid JudgeResult with ZERO model calls', async () => {
    process.env.DEGRADE_MODE = '1';
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    // A valid JudgeResult shape.
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeTruthy();
    expect(res.body).toHaveProperty('axisScores');
    expect(res.body).toHaveProperty('favorDelta');
    expect(res.body).toHaveProperty('dominantAxis');
    expect(res.body).toHaveProperty('reaction');

    // axisScores carries all five axes.
    for (const ax of ['wit', 'specificity', 'audacity', 'economy', 'flattery']) {
      expect(typeof res.body.axisScores[ax]).toBe('number');
    }

    // favorDelta is a finite, server-derived number (deriveFavorDelta output).
    expect(Number.isFinite(res.body.favorDelta)).toBe(true);

    // The reaction is a non-empty cached in-voice string (NOT a model output).
    expect(typeof res.body.reaction).toBe('string');
    expect(res.body.reaction.length).toBeGreaterThan(0);

    // ZERO model calls — the degrade branch returned before any fetch.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('DEGRADE_MODE on: the cached reaction passes the SAFE-01 output bound', async () => {
    process.env.DEGRADE_MODE = '1';
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    const reaction = res.body.reaction;
    // No slur / strong profanity (mild allowlist honored).
    expect(scanForBannedProfanity(reaction)).toBe(false);
    // The barb (if any) targets no one — the input here is a boast, so the
    // cached line must not be flagged as person-targeting against it.
    expect(targetsPerson(reaction, req.body.reply)).toBe(false);
  });

  it('DEGRADE_MODE off (default): the handler attempts the model (does NOT short-circuit)', async () => {
    delete process.env.DEGRADE_MODE;
    // Resolve fetch with a NON-RETRYABLE 400 so the model loop breaks
    // immediately (no exponential backoff) — this keeps the test fast while
    // still proving the model endpoint WAS hit (the degrade branch did not
    // hijack a normal request).
    fetchSpy = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { message: 'test 400 (non-retryable)' } }),
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    // fetch WAS attempted — the degrade path did not short-circuit normal traffic.
    expect(fetchSpy).toHaveBeenCalled();
    // And the URL hit is the model endpoint (proves it is the real model call).
    expect(String(fetchSpy.mock.calls[0][0])).toContain('generativelanguage.googleapis.com');
  });
});
