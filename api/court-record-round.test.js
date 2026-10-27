// ============================================================================
// court-record-round — the outcome is DERIVED from verified deltas (2026-10-23).
//
// The bug: the recorder took `final_favor`, `turns_used` and each turn's
// `favor_delta` from the body as reported, and its UPDATE had no guard against a
// terminal (won/lost) round — so a client could POST final_favor:100 and win, or
// re-POST to flip a lost round. Now every turn must carry the judge's turn_tag
// (api/_turn-tag.js), the counters are replayed from the verified deltas with the
// client's clamp (src/round.ts applyTurn), and the UPDATE is fenced to
// outcome='in_progress'.
//
// Contract asserted here (handler invoked for real; @supabase/supabase-js and
// @vercel/functions mocked; the fake client records the UPDATE payload + filters):
//   (3) a client final_favor:100 / turns_used:1 / outcome:'won' is IGNORED — the
//       recorded row is derived from the verified deltas (one +30 turn ⇒ favor 30,
//       turns_used 1, in_progress);
//   (4) a turn whose delta was altered after signing (or whose tag is missing /
//       forged / replayed into another slot) is rejected 422 `turn_unverified` and
//       NOTHING is written;
//   (5) a round that is already won/lost cannot be re-updated — the UPDATE carries
//       the outcome fence, zero rows match, and the handler returns 409
//       `round_already_terminal`;
//   plus: three honest turns that sum past 100 derive 'won' at the capped 100, and
//   three honest turns short of 100 derive 'lost'.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Fake Supabase: a minimal chainable query builder that records what the
//    handler asks for. Table rows are seeded per test via `state`. ──
const state = {
  playerRow: { id: 'player-uuid-1' },
  roundRow: null,          // the court_rounds row that exists for (player, day)
  updates: [],             // every .update() call: { table, payload, filters }
  upserts: [],             // every .upsert() call
  rpcs: [],
};

function builder(table) {
  const q = { table, op: null, payload: null, filters: [] };
  const api = {
    select() { if (!q.op) q.op = 'select'; return api; },
    update(payload) { q.op = 'update'; q.payload = payload; return api; },
    upsert(rows, opts) { state.upserts.push({ table, rows, opts }); return Promise.resolve({ data: null, error: null }); },
    eq(col, val) { q.filters.push([col, val]); return api; },
    order() { return api; },
    maybeSingle() { return Promise.resolve(resolve()); },
    then(onOk, onErr) { return Promise.resolve(resolve()).then(onOk, onErr); },
  };
  function resolve() {
    if (table === 'court_players') return { data: state.playerRow, error: null };
    if (table === 'court_rounds') {
      if (q.op === 'update') {
        state.updates.push({ table, payload: q.payload, filters: q.filters });
        const row = state.roundRow;
        // Apply the filters the way Postgres would: a terminal row does NOT match
        // the outcome='in_progress' fence ⇒ zero rows updated ⇒ data null.
        const matches = row && q.filters.every(([c, v]) => row[c] === v);
        if (!matches) return { data: null, error: null };
        Object.assign(row, q.payload);
        return { data: { ...row }, error: null };
      }
      return { data: state.roundRow ? { ...state.roundRow } : null, error: null };
    }
    return { data: [], error: null };
  }
  return api;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => builder(table),
    rpc: (name, args) => {
      state.rpcs.push({ name, args });
      // court_start_round: INSERT ... ON CONFLICT DO NOTHING — seed the row only if absent.
      if (!state.roundRow) {
        state.roundRow = {
          player_id: args.p_player_id, day: args.p_day, rubric_version: args.p_rubric,
          outcome: 'in_progress', turns_used: 0, final_favor: 0,
        };
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));

const { default: handler } = await import('./court-record-round.js');
const { getDayNumber } = await import('./_day.js');
const { signTurnTag } = await import('./_turn-tag.js');

const SECRET = 'test-turn-secret';
const TOKEN = 'test-player-token';

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    end() { return this; },
  };
}

// Build a turn the judge would have issued: the tag is signed over the SAME fields the
// recorder verifies — bearer token, server day, slot index, delta, raw reply.
function signedTurn(i, favorDelta, reply = `Reply number ${i}, Sire.`) {
  return {
    turn_index: i, reply, reaction: 'A reaction.', favor_delta: favorDelta, dominant_axis: 'wit',
    turn_tag: signTurnTag({ token: TOKEN, day: getDayNumber(), turnIndex: i, favorDelta, reply }, SECRET),
  };
}

function makeReq(body) {
  return {
    method: 'POST',
    headers: { origin: 'https://court.yapoleon.com', authorization: `Bearer ${TOKEN}` },
    body: { rubric_version: 'fairfight-v2', ...body },
  };
}

async function record(body) {
  const res = makeRes();
  await handler(makeReq(body), res);
  return res;
}

describe('court-record-round — outcome derived from tag-verified deltas', () => {
  const priorEnv = {};

  beforeEach(() => {
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'COURT_TURN_SECRET', 'GEMINI_API_KEY']) priorEnv[k] = process.env[k];
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.COURT_TURN_SECRET = SECRET;
    delete process.env.GEMINI_API_KEY; // the dossier summarizer must not try the model
    state.roundRow = null;
    state.updates = [];
    state.upserts = [];
    state.rpcs = [];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(priorEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('(3) IGNORES a client final_favor:100 — the row is derived from the verified deltas', async () => {
    const res = await record({
      final_favor: 100, turns_used: 1, outcome: 'won',   // the lie
      turns: [signedTurn(0, 30)],                        // the truth the judge signed
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.round).toMatchObject({ final_favor: 30, turns_used: 1, outcome: 'in_progress' });
    // The UPDATE the handler issued carried the derived numbers, not the body's.
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].payload).toMatchObject({ final_favor: 30, turns_used: 1, outcome: 'in_progress' });
  });

  it('(4) rejects a forged delta (altered after signing) with 422 turn_unverified and writes nothing', async () => {
    const honest = signedTurn(0, 10);
    const forged = { ...honest, favor_delta: 52 };     // same tag, inflated number
    const res = await record({ turns: [forged] });
    expect(res.statusCode).toBe(422);
    expect(res.body.code).toBe('turn_unverified');
    expect(res.body.turn_index).toBe(0);
    expect(state.updates).toHaveLength(0);
    expect(state.upserts).toHaveLength(0);
    expect(state.rpcs).toHaveLength(0);                 // not even the start RPC ran
  });

  it('(4) rejects a missing tag, a garbage tag, and a genuine tag replayed into another slot', async () => {
    const { turn_tag: _drop, ...untagged } = signedTurn(0, 40);
    expect((await record({ turns: [untagged] })).statusCode).toBe(422);

    expect((await record({ turns: [{ ...signedTurn(0, 40), turn_tag: 'f'.repeat(64) }] })).statusCode).toBe(422);

    // One real +52 echoed three times: slots 1 and 2 were signed for slot 0 ⇒ fail.
    const big = signedTurn(0, 52);
    const replayed = await record({ turns: [big, { ...big, turn_index: 1 }, { ...big, turn_index: 2 }] });
    expect(replayed.statusCode).toBe(422);
    expect(replayed.body.turn_index).toBe(1);
    expect(state.updates).toHaveLength(0);
  });

  it('(4) rejects a tag minted for another player (the bearer is bound into the tag)', async () => {
    const t = signedTurn(0, 40);
    t.turn_tag = signTurnTag({ token: 'someone-else', day: getDayNumber(), turnIndex: 0, favorDelta: 40, reply: t.reply }, SECRET);
    expect((await record({ turns: [t] })).statusCode).toBe(422);
  });

  it('(5) a terminal round cannot be re-updated: the fence matches nothing ⇒ 409', async () => {
    state.roundRow = {
      player_id: 'player-uuid-1', day: getDayNumber(), rubric_version: 'fairfight-v2',
      outcome: 'lost', turns_used: 3, final_favor: 40,
    };
    const res = await record({ turns: [signedTurn(0, 52), signedTurn(1, 52)] });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('round_already_terminal');
    expect(res.body.outcome).toBe('lost');
    // The UPDATE carried the outcome fence, and the stored row is untouched.
    expect(state.updates[0].filters).toContainEqual(['outcome', 'in_progress']);
    expect(state.roundRow).toMatchObject({ outcome: 'lost', turns_used: 3, final_favor: 40 });
    expect(state.upserts).toHaveLength(0);
  });

  it('derives won (capped at 100) from honest deltas that sum past the threshold', async () => {
    const res = await record({ turns: [signedTurn(0, 45), signedTurn(1, 52), signedTurn(2, 52)] });
    expect(res.statusCode).toBe(200);
    // 45 + 52 = 97, + 52 ⇒ 149 → clamped 100 → won on the 3rd turn.
    expect(res.body.round).toMatchObject({ final_favor: 100, turns_used: 3, outcome: 'won' });
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0].rows).toHaveLength(3);
    expect(state.upserts[0].rows.map((r) => r.favor_delta)).toEqual([45, 52, 52]);
  });

  it('derives lost from three honest turns that stay below 100 (floor applied, never negative)', async () => {
    const res = await record({ turns: [signedTurn(0, -28), signedTurn(1, 30), signedTurn(2, 20)] });
    expect(res.statusCode).toBe(200);
    // -28 → floor 0; +30 → 30; +20 → 50; 3 turns used below 100 ⇒ lost.
    expect(res.body.round).toMatchObject({ final_favor: 50, turns_used: 3, outcome: 'lost' });
  });

  it('fails closed without COURT_TURN_SECRET (500 missing_turn_secret, nothing written)', async () => {
    delete process.env.COURT_TURN_SECRET;
    const res = await record({ turns: [signedTurn(0, 30)] });
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('missing_turn_secret');
    expect(state.updates).toHaveLength(0);
  });
});
