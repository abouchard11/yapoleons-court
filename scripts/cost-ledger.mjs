#!/usr/bin/env node
// ============================================================================
// COST-03 — per-DAU LLM-call + cost ledger (a READ-only aggregation).
//
// Aggregates the existing per-call token ledger (yapoleon_observability_events,
// migration court_005) by day + mode, translates tokens to $ at verified
// gemini-3.5-flash pricing, and divides by the per-day active-player count
// (distinct court_rounds.player_id/day) to produce the per-DAU numbers.
//
// This is a READ path ONLY. It NEVER writes: it reuses the same service-role
// read the observability digest uses (mirrors api/_yapoleon-observability.js
// fetchYapoleonEventsSince) plus a distinct-count read of court_rounds. No new
// writer, no new table (D-08).
//
// PER-DAU DENOMINATOR (D-07 — obs stays player-anonymous): the observability
// table has NO player_id column, BY DESIGN (a token row is never joined to a
// player identity — that is the no-PII posture). So the DAU denominator comes
// from court_rounds: the count of DISTINCT player_id that played on a given day.
// The aggregate token/$ figure is divided by that count. We never join a token
// row to a player_id; we divide an aggregate by a headcount.
//
// NOTE on the two time axes: yapoleon_observability_events is timestamped
// (created_at TIMESTAMPTZ); court_rounds is keyed by an integer `day`
// (getDayNumber()), NOT a timestamp. So the token aggregate is grouped by the
// calendar day of created_at, and the DAU denominator is the distinct-player
// count grouped by court_rounds.day. Over a normal steady window these line up
// day-for-day; the ledger reports BOTH the per-calendar-day token/$ table and
// the DAU headcount so the divide is transparent, not hidden.
//
// HARD INVARIANT: nothing in this script touches favor / rubric / weights /
// threshold. It reads token + player-count data and prints a report. It never
// imports deriveFavorDelta and never influences scoring.
//
// Usage:
//   node scripts/cost-ledger.mjs            # last 7 days
//   node scripts/cost-ledger.mjs --days 30  # last 30 days
//   node scripts/cost-ledger.mjs --json     # machine-readable output
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment
// (the same server-only secrets the API functions use — never VITE_).
// ============================================================================

import { createClient } from '@supabase/supabase-js';

// ── Verified gemini-3.5-flash pricing ($/1e6 tokens). ───────────────────────
// D-08: pricing ages — RE-VERIFY at execution time at the source below and bump
// PRICING_VERIFIED_ON when you do. Thinking/thoughts tokens are billed at the
// OUTPUT rate (confirmed at the pricing page + the thinking docs).
const PRICING_VERIFIED_ON = '2026-07-01'; // ai.google.dev/gemini-api/docs/pricing
const PRICING_SOURCE = 'https://ai.google.dev/gemini-api/docs/pricing';
const PRICE = {
  // gemini-3.5-flash — the primary judge/greeting/summarizer model.
  'gemini-3.5-flash': { inputPerM: 1.50, outputPerM: 9.00 },
  // gemini-2.5-flash — the fallback model. CHEAPER; cost is dominated by 3.5-flash.
  'gemini-2.5-flash': { inputPerM: 0.30, outputPerM: 2.50 },
};
// The ledger prices the aggregate at the PRIMARY model (the conservative, higher
// number). thoughts_tokens are folded into the output side (billed at outputPerM).
const PRIMARY_MODEL = 'gemini-3.5-flash';

// ── The per-round Gemini-call envelope (COST-01, verified in code). ──────────
// greeting: 1 (cold-start = 0, deterministic), judge: <=3 (one/turn, 3-turn cap),
// summarizer: 1 (terminal round only) => MAX 5 calls per completed round (D-08).
const MAX_CALLS_PER_ROUND = 5;

const EVENTS_TABLE = 'yapoleon_observability_events';
const ROUNDS_TABLE = 'court_rounds';

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Per-call $ at the primary model. thoughts_tokens billed at the OUTPUT rate.
// Exported (pure) for the regression test.
export function callCost(inTok, outTok, thinkTok) {
  const p = PRICE[PRIMARY_MODEL];
  return (
    (Number(inTok || 0) / 1e6) * p.inputPerM +
    ((Number(outTok || 0) + Number(thinkTok || 0)) / 1e6) * p.outputPerM
  );
}

function dayKey(iso) {
  // Calendar (UTC) day of the event timestamp.
  return new Date(iso).toISOString().slice(0, 10);
}

// Read status-200 obs rows in the window (mirrors fetchYapoleonEventsSince's
// service-role read; adds the token columns this aggregation needs).
async function fetchEvents(sb, sinceIso, maxRows = 50000) {
  const { data, error } = await sb
    .from(EVENTS_TABLE)
    .select(
      'created_at, mode, status_code, prompt_tokens, output_tokens, thoughts_tokens, total_tokens',
    )
    .gte('created_at', sinceIso)
    .eq('status_code', 200)
    .order('created_at', { ascending: false })
    .limit(maxRows);
  if (error) throw new Error(`obs read failed: ${error.message}`);
  return data || [];
}

// The DAU denominator: distinct court_rounds.player_id per day. We select only
// (day, player_id) and reduce to a distinct-count/day in JS — we NEVER carry a
// player_id into the token aggregate (D-07); we only count heads per day.
async function fetchDauByDay(sb, maxRows = 50000) {
  const { data, error } = await sb
    .from(ROUNDS_TABLE)
    .select('day, player_id')
    .order('day', { ascending: false })
    .limit(maxRows);
  if (error) throw new Error(`rounds read failed: ${error.message}`);
  const byDay = new Map(); // day(int) -> Set<player_id>
  for (const row of data || []) {
    if (row.day == null || row.player_id == null) continue;
    if (!byDay.has(row.day)) byDay.set(row.day, new Set());
    byDay.get(row.day).add(row.player_id);
  }
  const out = new Map(); // day(int) -> distinct player count
  for (const [day, set] of byDay) out.set(day, set.size);
  return out;
}

// Group the token aggregate by calendar day + mode.
function aggregate(events) {
  const byDayMode = new Map(); // `${day}|${mode}` -> tallies
  for (const e of events) {
    const day = dayKey(e.created_at);
    const mode = e.mode || 'unknown';
    const k = `${day}|${mode}`;
    if (!byDayMode.has(k)) {
      byDayMode.set(k, {
        day,
        mode,
        calls: 0,
        inTok: 0,
        outTok: 0,
        thinkTok: 0,
        totalTok: 0,
      });
    }
    const row = byDayMode.get(k);
    row.calls += 1;
    row.inTok += Number(e.prompt_tokens || 0);
    row.outTok += Number(e.output_tokens || 0);
    row.thinkTok += Number(e.thoughts_tokens || 0);
    row.totalTok += Number(e.total_tokens || 0);
  }
  return [...byDayMode.values()];
}

function summarize(rows) {
  // Per-calendar-day totals across all modes (for the DAU divide + the envelope check).
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day)) {
      byDay.set(r.day, { day: r.day, calls: 0, inTok: 0, outTok: 0, thinkTok: 0, totalTok: 0 });
    }
    const d = byDay.get(r.day);
    d.calls += r.calls;
    d.inTok += r.inTok;
    d.outTok += r.outTok;
    d.thinkTok += r.thinkTok;
    d.totalTok += r.totalTok;
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

// Per-DAU aggregation. The window total (tokens / cost / calls) is divided by
// DAU-DAYS — the sum of each day's distinct-player count — NOT the single peak-day
// DAU. Dividing a multi-day total by one day's headcount understates the
// denominator and overstates per-DAU. Exported (pure) for the regression test.
//
// Method equivalence: total ÷ DAU-days == the DAU-weighted average of each day's
// (daily cost ÷ daily DAU), so both formulations in the fix spec agree. peakDayDau
// is carried through as a reported diagnostic only (it is NOT the divisor).
export function computePerDau(perDay, dauDays, peakDayDau) {
  const totalTok = perDay.reduce((s, d) => s + d.totalTok, 0);
  const totalCalls = perDay.reduce((s, d) => s + d.calls, 0);
  const totalCost = perDay.reduce((s, d) => s + callCost(d.inTok, d.outTok, d.thinkTok), 0);
  const divisor = dauDays || 1; // guard div-by-zero on an empty window
  return {
    // The denominator is Σ(distinct players per day) — obs stays player-anonymous
    // (D-07): we divide an aggregate by a headcount, never join a token row to a
    // player_id.
    denominator_method:
      'window total ÷ DAU-days (Σ distinct court_rounds.player_id per day) ' +
      '— equivalently the DAU-weighted avg of daily (cost ÷ DAU); obs has no player_id (D-07)',
    dau_days: dauDays,
    peak_day_dau: peakDayDau, // diagnostic only — NOT the divisor
    tokens_per_dau: Number((totalTok / divisor).toFixed(1)),
    cost_per_dau_usd: Number((totalCost / divisor).toFixed(6)),
    avg_calls_per_dau: Number((totalCalls / divisor).toFixed(2)),
  };
}

function fmt$(n) {
  return `$${n.toFixed(4)}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const daysIdx = argv.indexOf('--days');
  const days = daysIdx >= 0 ? Number(argv[daysIdx + 1]) || 7 : 7;
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const sb = getClient();
  if (!sb) {
    console.error(
      'cost-ledger: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required (server-only secrets). ' +
        'Set them in the environment (never VITE_-prefixed).',
    );
    process.exit(2);
  }

  const [events, dauByDay] = await Promise.all([
    fetchEvents(sb, sinceIso),
    fetchDauByDay(sb),
  ]);

  const perDayMode = aggregate(events);
  const perDay = summarize(perDayMode);

  // Attach $ + the DAU divide. The DAU count is keyed by court_rounds.day (int);
  // we approximate the calendar-day <-> day mapping by ordinal alignment of the
  // window's days (documented caveat above) and expose the raw DAU map too.
  //
  // PER-DAU DENOMINATOR = DAU-DAYS (fix): the correct divisor for a WINDOW total is
  // the sum of each day's distinct-player count (DAU-days), NOT the single peak-day
  // DAU. Dividing a multi-day total by one day's headcount understates the
  // denominator and OVERSTATES per-DAU (e.g. 7 days × 10 DAU = 70 DAU-days, not 10).
  // We also keep the peak-day DAU purely as a reported diagnostic.
  const dauCounts = [...dauByDay.values()];
  const dauDays = dauCounts.reduce((s, n) => s + n, 0); // Σ distinct players per day
  const peakDayDau = dauCounts.length ? Math.max(...dauCounts) : 0; // diagnostic only

  const report = {
    window_days: days,
    since: sinceIso,
    pricing: {
      model: PRIMARY_MODEL,
      input_per_million: PRICE[PRIMARY_MODEL].inputPerM,
      output_per_million: PRICE[PRIMARY_MODEL].outputPerM,
      thoughts_billed_at: 'output rate',
      fallback_model: 'gemini-2.5-flash',
      fallback_input_per_million: PRICE['gemini-2.5-flash'].inputPerM,
      fallback_output_per_million: PRICE['gemini-2.5-flash'].outputPerM,
      verified_on: PRICING_VERIFIED_ON,
      source: PRICING_SOURCE,
      reverify_note: `RE-VERIFY at ${PRICING_SOURCE} at execution time (D-08); bump PRICING_VERIFIED_ON.`,
    },
    envelope: { max_calls_per_round: MAX_CALLS_PER_ROUND },
    per_day: perDay.map((d) => {
      const cost = callCost(d.inTok, d.outTok, d.thinkTok);
      return {
        day: d.day,
        calls: d.calls,
        total_tokens: d.totalTok,
        prompt_tokens: d.inTok,
        output_tokens: d.outTok,
        thoughts_tokens: d.thinkTok,
        cost_usd: Number(cost.toFixed(6)),
      };
    }),
    per_mode: perDayMode
      .map((r) => ({
        day: r.day,
        mode: r.mode,
        calls: r.calls,
        total_tokens: r.totalTok,
        cost_usd: Number(callCost(r.inTok, r.outTok, r.thinkTok).toFixed(6)),
      }))
      .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.mode.localeCompare(b.mode))),
    dau_by_court_rounds_day: Object.fromEntries(dauByDay),
    per_dau: computePerDau(perDay, dauDays, peakDayDau),
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Human-readable render.
  console.log('═══ COST-03 per-DAU cost ledger ═══');
  console.log(`window: last ${days} day(s) (since ${sinceIso})`);
  console.log(
    `pricing: ${PRIMARY_MODEL} $${PRICE[PRIMARY_MODEL].inputPerM}/M in, $${PRICE[PRIMARY_MODEL].outputPerM}/M out ` +
      `(thoughts @ output rate) — verified ${PRICING_VERIFIED_ON} (${PRICING_SOURCE})`,
  );
  console.log(`  RE-VERIFY pricing at execution time (D-08). fallback gemini-2.5-flash is cheaper ($0.30/$2.50).`);
  console.log(`envelope: <= ${MAX_CALLS_PER_ROUND} Gemini calls per completed round (greeting + <=3 judge + summarizer)\n`);

  if (report.per_day.length === 0) {
    console.log('(no status-200 observability rows in the window — nothing to aggregate yet)');
  } else {
    console.log('per calendar day (all modes):');
    for (const d of report.per_day) {
      console.log(
        `  ${d.day}  calls=${String(d.calls).padStart(4)}  total_tok=${String(d.total_tokens).padStart(8)}  ` +
          `cost=${fmt$(d.cost_usd)}`,
      );
    }
    console.log('\nper day + mode:');
    for (const r of report.per_mode) {
      console.log(
        `  ${r.day}  ${r.mode.padEnd(11)}  calls=${String(r.calls).padStart(4)}  ` +
          `total_tok=${String(r.total_tokens).padStart(8)}  cost=${fmt$(r.cost_usd)}`,
      );
    }
  }

  console.log('\nDAU (distinct court_rounds.player_id per day):');
  const dauEntries = [...dauByDay.entries()].sort((a, b) => b[0] - a[0]);
  if (dauEntries.length === 0) {
    console.log('  (no court_rounds rows yet)');
  } else {
    for (const [day, count] of dauEntries) console.log(`  day ${day}: ${count} player(s)`);
  }

  console.log('\nper-DAU (window total ÷ DAU-days = Σ distinct players/day — obs stays player-anonymous, D-07):');
  console.log(`  DAU-days (divisor):  ${report.per_dau.dau_days}`);
  console.log(`  peak-day DAU (diag): ${report.per_dau.peak_day_dau}`);
  console.log(`  tokens / DAU:        ${report.per_dau.tokens_per_dau}`);
  console.log(`  cost / DAU:          ${fmt$(report.per_dau.cost_per_dau_usd)}`);
  console.log(`  avg calls / DAU:     ${report.per_dau.avg_calls_per_dau}`);
  console.log('\nSee docs/economics/per-dau-cost-ledger.md for the ceiling (BUDGET_TOKENS) + the degradation levers.');
}

// Run main() ONLY when executed directly (node scripts/cost-ledger.mjs), NOT when
// imported (e.g. by the regression test, which imports the pure computePerDau /
// callCost helpers). Without this guard, importing the module would run the CLI and
// process.exit() out of the test.
import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';

const isMain = argv[1] && import.meta.url === pathToFileURL(argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error('cost-ledger failed:', err.message);
    process.exit(1);
  });
}
