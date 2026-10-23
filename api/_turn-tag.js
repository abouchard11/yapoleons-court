// ─────────────────────────────────────────────────────────────────────
//  Per-turn verification tag — the server's signature over the delta it issued
// ─────────────────────────────────────────────────────────────────────
// 2026-10-23 HTTP-layer hardening. deriveFavorDelta has always been server-owned
// (the model never emits the number), but the RECORD step trusted the client:
// court-record-round took `final_favor`, `turns_used` and each turn's
// `favor_delta` as reported, so a client could POST final_favor:100 and win
// without the judge ever agreeing. The fix is stateless: the judge now returns,
// beside each JudgeResult, an HMAC-SHA256 tag over
//
//   { bearer token, day, turn_index, favorDelta, sha256(reply) }
//
// keyed by COURT_TURN_SECRET (server-only env). The client echoes the tag per
// turn (TurnRecord.turn_tag) and court-record-round re-computes it for every
// turn before summing; a turn whose tag does not verify is rejected outright
// (422 `turn_unverified`) and final_favor / turns_used / outcome are DERIVED
// from the verified deltas alone — never read from the body.
//
// Why these fields:
//   token      — binds the delta to the player who earned it (the bearer is the
//                only client-held credential; record-round sees the same one).
//   day        — binds it to the round (server-derived on both ends via _day.js;
//                a tag minted yesterday cannot be recorded into today's round).
//   turnIndex  — binds it to a slot, so a +52 cannot be echoed three times.
//   favorDelta — the number itself, so it cannot be inflated in transit.
//   reply hash — the judged text, so the persisted court_turns transcript (the
//                dossier's extractive source of truth) is the text that was judged.
//
// Chosen over persisting turns at judge time because it needs no migration, no
// DB access on the judge path (the degrade path and the no-Supabase tests stay
// intact), and preserves the client-side "a turn is consumed only when applied"
// contract. Residual (pre-existing, unchanged): a client may call the judge more
// than once for the same slot and keep the better tag — the per-user rate limit
// and the 3-turn cap bound that; it is not a free win.
//
// HARD INVARIANT (D-01): nothing here touches the rubric, the weights, the curve
// or the threshold. The tag only proves a number the fairness backbone already
// produced.

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const TURN_SECRET_ENV = 'COURT_TURN_SECRET';

// Read at request time (not module load) so a Vercel env change takes effect
// immediately and so it is unit-testable per request. Empty ⇒ null (fail closed
// at the call sites: the judge returns 500 `missing_turn_secret`, the recorder
// likewise — a round can never be recorded on an unsigned delta).
export function getTurnSecret() {
  return process.env[TURN_SECRET_ENV] || null;
}

function replyHash(reply) {
  return createHash('sha256').update(String(reply ?? ''), 'utf8').digest('hex');
}

// Canonical message. Fields are pipe-joined after being reduced to a fixed shape
// (integers for day/turnIndex/favorDelta, a hex digest for the reply) so no field
// can smuggle a delimiter.
function message({ token, day, turnIndex, favorDelta, reply }) {
  return [
    String(token ?? ''),
    String(Math.trunc(Number(day))),
    String(Math.trunc(Number(turnIndex))),
    String(Math.trunc(Number(favorDelta))),
    replyHash(reply),
  ].join('|');
}

// Sign one issued delta. Returns the hex tag, or null when the secret is unset.
export function signTurnTag(fields, secret = getTurnSecret()) {
  if (!secret) return null;
  return createHmac('sha256', secret).update(message(fields), 'utf8').digest('hex');
}

// Verify a client-echoed tag against the server's own recomputation. Constant-time
// compare; any malformed input (non-string, wrong length, unset secret) is false.
export function verifyTurnTag(tag, fields, secret = getTurnSecret()) {
  if (!secret || typeof tag !== 'string') return false;
  const expected = signTurnTag(fields, secret);
  if (!expected) return false;
  const a = Buffer.from(tag, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
