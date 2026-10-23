// ============================================================================
// Server-owned axis weights + signed deltas (2026-10-23 HTTP-layer hardening).
//
// The bug: api/court-judge.js read `axisWeights` from the request body, checked
// only non-negative / sum > 0, and fed them to deriveFavorDelta — so a client
// could POST an inflated vector and receive an arbitrary favorDelta. The weights
// now come from the server's own table (api/_demand-weights.js) selected by the
// server's own day (api/_day.js), and the body field is ignored.
//
// Contract asserted here (handler invoked for real, model `fetch` mocked):
//   1. A tampered body.axisWeights does NOT change favorDelta — the same reply on
//      the same day yields the same delta whether the body carries honest weights,
//      a 1000x vector, a single-axis vector, garbage, or no field at all.
//   2. favorDelta for a pinned day equals deriveFavorDelta(axisScores, weights) using
//      the CLIENT's weights for that day (src/demands.ts selectDailyDemand) — the
//      server picked the same demand the client is showing.
//   3. The judge refuses to issue an unsignable delta: no bearer ⇒ 401
//      `missing_token`; no COURT_TURN_SECRET ⇒ 500 `missing_turn_secret`; and the
//      happy path carries a turnTag that verifies for {token, day, slot, delta, reply}.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from './court-judge.js';
import { getDayNumber } from './_day.js';
import { verifyTurnTag } from './_turn-tag.js';
import { selectDailyDemand } from '../src/demands.ts';
import { deriveFavorDelta } from '../src/judge.ts';

const SECRET = 'test-turn-secret';
const TOKEN = 'test-player-token';
const REPLY = 'I bring you a mirror, Sire, so you may admire the only worthy subject here.';

// The axis scores the mocked model "returns" — deliberately uneven so a swapped
// weight vector would visibly move the delta.
const MODEL_SCORES = { wit: 0.9, specificity: 0.2, audacity: 0.7, economy: 0.1, flattery: 0.4 };

function makeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    end() { return this; },
  };
}

function makeReq({ axisWeights, authorization = `Bearer ${TOKEN}`, priorReplies = [] } = {}) {
  const body = {
    scene: 'The Emperor demands you justify your presence in his court.',
    reply: REPLY,
    priorReplies,
  };
  if (axisWeights !== undefined) body.axisWeights = axisWeights;
  const headers = { origin: 'https://court.yapoleon.com' };
  if (authorization) headers.authorization = authorization;
  return { method: 'POST', headers, body };
}

// A successful :generateContent response carrying MODEL_SCORES as the JSON text.
function modelOk() {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        axisScores: MODEL_SCORES, dominantAxis: 'wit', reaction: 'A tolerable turn.',
      }) }] } }],
      usageMetadata: null,
    }),
  });
}

async function judge(reqOverrides) {
  const res = makeRes();
  await handler(makeReq(reqOverrides), res);
  return res;
}

describe('court-judge — axis weights are SERVER-owned', () => {
  const priorEnv = {};

  beforeEach(() => {
    for (const k of ['GEMINI_API_KEY', 'DEGRADE_MODE', 'COURT_TURN_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
      priorEnv[k] = process.env[k];
    }
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.COURT_TURN_SECRET = SECRET;
    delete process.env.DEGRADE_MODE;
    // No Supabase env → readShapeNotes short-circuits to [] (no DB on this path).
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.stubGlobal('fetch', vi.fn(modelOk));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    for (const [k, v] of Object.entries(priorEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('(1) a tampered body.axisWeights does NOT change favorDelta', async () => {
    const honest = await judge({ axisWeights: selectDailyDemand(getDayNumber()).axisWeights });
    expect(honest.statusCode).toBe(200);
    const baseline = honest.body.favorDelta;
    expect(Number.isFinite(baseline)).toBe(true);

    const tampered = [
      { wit: 1000, specificity: 1000, audacity: 1000, economy: 1000, flattery: 1000 }, // inflated
      { wit: 1, specificity: 0, audacity: 0, economy: 0, flattery: 0 },                // single-axis
      { wit: 0, specificity: 0, audacity: 0, economy: 0, flattery: 1 },                // other axis
      'garbage',                                                                        // not an object
      null,                                                                             // null
      undefined,                                                                        // absent
    ];
    for (const axisWeights of tampered) {
      const res = await judge({ axisWeights });
      expect(res.statusCode).toBe(200);
      expect(res.body.favorDelta).toBe(baseline);
    }
  });

  it('(2) favorDelta for a pinned day equals the CLIENT weights for that day (selection mirror)', async () => {
    // Pin several distinct NY-midday instants so the day (and thus the demand) varies
    // and the equality is not an accident of one weight vector.
    const instants = [
      '2026-10-23T17:00:00Z', '2026-11-04T17:00:00Z', '2026-12-25T17:00:00Z',
      '2027-02-14T17:00:00Z', '2027-07-04T17:00:00Z',
    ];
    const seenIds = new Set();
    for (const iso of instants) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(iso));
      const day = getDayNumber();
      const clientDemand = selectDailyDemand(day);
      seenIds.add(clientDemand.id);

      const res = await judge({});
      expect(res.statusCode).toBe(200);
      // The server derived the delta with THIS day's client-side weights.
      expect(res.body.favorDelta).toBe(deriveFavorDelta(MODEL_SCORES, clientDemand.axisWeights));
      vi.useRealTimers();
    }
    // The pinned days exercised more than one demand (the mirror held across them).
    expect(seenIds.size).toBeGreaterThan(1);
  });

  it('(2b) the degrade path uses the same server-selected weights', async () => {
    process.env.DEGRADE_MODE = '1';
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no model on degrade'))));
    const day = getDayNumber();
    const neutral = { wit: 0.5, specificity: 0.5, audacity: 0.5, economy: 0.5, flattery: 0.5 };
    const res = await judge({ axisWeights: { wit: 99, specificity: 99, audacity: 99, economy: 99, flattery: 99 } });
    expect(res.statusCode).toBe(200);
    expect(res.body.favorDelta).toBe(deriveFavorDelta(neutral, selectDailyDemand(day).axisWeights));
  });

  it('(3) issues a turnTag that verifies for {token, day, slot, delta, reply} and nothing else', async () => {
    const res = await judge({ priorReplies: ['an earlier line'] }); // slot 1
    expect(res.statusCode).toBe(200);
    const { favorDelta, turnTag } = res.body;
    const day = getDayNumber();
    expect(verifyTurnTag(turnTag, { token: TOKEN, day, turnIndex: 1, favorDelta, reply: REPLY }, SECRET)).toBe(true);
    // Any single field moved ⇒ the tag no longer verifies.
    expect(verifyTurnTag(turnTag, { token: 'other', day, turnIndex: 1, favorDelta, reply: REPLY }, SECRET)).toBe(false);
    expect(verifyTurnTag(turnTag, { token: TOKEN, day: day - 1, turnIndex: 1, favorDelta, reply: REPLY }, SECRET)).toBe(false);
    expect(verifyTurnTag(turnTag, { token: TOKEN, day, turnIndex: 0, favorDelta, reply: REPLY }, SECRET)).toBe(false);
    expect(verifyTurnTag(turnTag, { token: TOKEN, day, turnIndex: 1, favorDelta: favorDelta + 1, reply: REPLY }, SECRET)).toBe(false);
    expect(verifyTurnTag(turnTag, { token: TOKEN, day, turnIndex: 1, favorDelta, reply: REPLY + '!' }, SECRET)).toBe(false);
    expect(verifyTurnTag(turnTag, { token: TOKEN, day, turnIndex: 1, favorDelta, reply: REPLY }, 'wrong-secret')).toBe(false);
  });

  it('(3) refuses to issue an unsignable delta: no bearer ⇒ 401, no secret ⇒ 500, no model call either way', async () => {
    const noToken = await judge({ authorization: null });
    expect(noToken.statusCode).toBe(401);
    expect(noToken.body.code).toBe('missing_token');

    delete process.env.COURT_TURN_SECRET;
    const noSecret = await judge({});
    expect(noSecret.statusCode).toBe(500);
    expect(noSecret.body.code).toBe('missing_turn_secret');

    // Both refusals happened BEFORE any model work (COST-01: a request we cannot
    // sign never spends a model call).
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
