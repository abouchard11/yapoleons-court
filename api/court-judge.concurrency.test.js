// ============================================================================
// COST-04 — concurrency damper is TOCTOU-safe (regression for the reservation race).
//
// The bug: the over-threshold CHECK (`inFlightJudgeCount >= MAX_CONCURRENT_JUDGE`)
// was separated from the INCREMENT by an `await readShapeNotes(...)`. Under a burst,
// every request read the counter below the threshold BEFORE any of them incremented,
// so they ALL entered the model loop — blowing past MAX_CONCURRENT_JUDGE.
//
// The fix reserves the slot atomically: `inFlightJudgeCount += 1` runs immediately
// after the degrade branch, with NO await between the check and the increment, and
// the surrounding `try { … } finally { inFlightJudgeCount -= 1 }` now encloses the
// readShapeNotes await (no counter leak if it throws).
//
// This file sets MAX_CONCURRENT_JUDGE=2 BEFORE importing the handler (the constant is
// read at module load), fires a concurrent burst while holding the model `fetch`
// pending (so the reserved slots stay occupied), and asserts EXACTLY the threshold
// reaches the model while the excess take the cached degrade path. It also asserts,
// structurally, that the increment precedes the readShapeNotes await in the source.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// MUST be set before the dynamic import below — MAX_CONCURRENT_JUDGE is a module-load
// constant in court-judge.js, so the env has to be in place before the module evaluates.
const THRESHOLD = 2;
process.env.MAX_CONCURRENT_JUDGE = String(THRESHOLD);
process.env.GEMINI_API_KEY = 'test-key-concurrency';
delete process.env.DEGRADE_MODE;
// No Supabase env → getSupabaseClient() returns null → readShapeNotes short-circuits
// to [] (it stays on the happy path; the point is the ORDERING of check vs increment).
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

// Dynamic import AFTER the env is set so the threshold constant picks up THRESHOLD.
const { default: handler } = await import('./court-judge.js');

const PROD_COURT_JUDGE_JS = readFileSync(
  fileURLToPath(new URL('./court-judge.js', import.meta.url)),
  'utf-8',
);

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

function makeReq() {
  return {
    method: 'POST',
    headers: { origin: 'https://court.yapoleon.com' },
    body: {
      scene: 'The Emperor demands you justify your presence in his court.',
      reply: 'I bring you a mirror, Sire, so you may admire the only worthy subject here.',
      axisWeights: { wit: 1, specificity: 1, audacity: 1, economy: 1, flattery: 1 },
      priorReplies: [],
    },
  };
}

describe('COST-04 — concurrency reservation is atomic with the check (TOCTOU regression)', () => {
  let fetchCallCount;
  let releaseFetch;

  beforeAll(() => {
    fetchCallCount = 0;
    // Hold every model call pending on a gate we control, so a reserved slot stays
    // occupied for the whole burst. Resolve to a non-retryable 400 (fast break, no
    // backoff) once released.
    const gate = new Promise((resolve) => { releaseFetch = resolve; });
    vi.stubGlobal('fetch', () => {
      fetchCallCount += 1;
      return gate.then(() => ({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { message: 'held-then-400 (test)' } }),
      }));
    });
  });

  afterAll(() => {
    releaseFetch?.();
    vi.unstubAllGlobals();
  });

  it('a concurrent burst cannot exceed MAX_CONCURRENT_JUDGE into the model path', async () => {
    const N = THRESHOLD + 4; // a burst well over the threshold
    const resList = Array.from({ length: N }, makeRes);
    const inFlight = resList.map((res) => handler(makeReq(), res));

    // Let all requests advance past the reservation point (microtask + timer drain)
    // WITHOUT releasing the held model calls — the reserved slots are all occupied.
    await new Promise((r) => setTimeout(r, 50));

    // The core assertion: only the threshold number of requests reached the model.
    // Pre-fix, all N passed the check before any incremented, so all N would fetch.
    expect(fetchCallCount).toBe(THRESHOLD);

    // The excess took the cached in-voice degrade path (0 model calls, still playable).
    const degraded = resList.filter(
      (r) => r.statusCode === 200 && typeof r.body?.reaction === 'string' && r.body.reaction.includes('thronged'),
    ).length;
    expect(degraded).toBe(N - THRESHOLD);

    // Release the held model calls and let everything settle (no dangling promises).
    releaseFetch();
    await Promise.allSettled(inFlight);

    // Even after release, no MORE than the threshold ever hit the model in this burst.
    expect(fetchCallCount).toBe(THRESHOLD);
  });

  it('structurally: the slot is reserved (increment) BEFORE the readShapeNotes await', () => {
    // The reservation must precede the readShapeNotes await, else the check→increment
    // pair is not atomic. This guards the ordering against a future refactor that
    // reintroduces an await between the over-threshold check and the increment.
    // Match the CODE statements (not prose): the increment statement and the actual
    // readShapeNotes CALL (with its argument), so a comment mentioning the await does
    // not skew the offsets.
    const incrementIdx = PROD_COURT_JUDGE_JS.indexOf('inFlightJudgeCount += 1;');
    const readShapeCallIdx = PROD_COURT_JUDGE_JS.indexOf('await readShapeNotes(getSupabaseClient()');
    expect(incrementIdx).toBeGreaterThan(-1);
    expect(readShapeCallIdx).toBeGreaterThan(-1);
    // The reservation must precede the readShapeNotes await — the whole fix.
    expect(incrementIdx).toBeLessThan(readShapeCallIdx);

    // The over-threshold check sits just above the reservation, and the ONLY code on
    // the fall-through path between them is the synchronous degrade `if` (which
    // `return`s before reaching the increment). We assert the check→increment span
    // holds no NON-degrade await: strip line comments AND the degrade branch body
    // (its `await logOutcome` legitimately precedes its early return), leaving only
    // the fall-through code, which must contain no await before the reservation.
    const checkIdx = PROD_COURT_JUDGE_JS.indexOf('const overConcurrency =');
    expect(checkIdx).toBeGreaterThan(-1);
    const fallThroughCode = PROD_COURT_JUDGE_JS
      .slice(checkIdx, incrementIdx)
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '')) // strip line comments
      .join('\n')
      // Remove the degrade branch body (everything up to and including its `return;`)
      // — its internal await runs only on the early-return path, not the fall-through.
      .replace(/if \(isDegradeMode\(\) \|\| overConcurrency\)[\s\S]*?return;\s*\}/, '');
    expect(fallThroughCode).not.toMatch(/\bawait\b/);
  });
});
