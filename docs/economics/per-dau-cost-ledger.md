# Per-DAU cost ledger (COST-03) + degradation path (COST-04)

**Requirement:** COST-03 (a written per-DAU LLM-call + cost ledger with a target ceiling) · COST-04 (a live, testable degradation/fallback path under load).
**Must-nail #3:** a daily AI game with an unbounded per-DAU spend and no degradation lever is one viral day from a shutdown. This doc makes the ceiling **explicit** and the safety valve **real**.
**Companion:** `scripts/cost-ledger.mjs` — the read-only aggregation that produces the live numbers below.

---

## 1. The per-round Gemini-call envelope (≤ 5 calls)

Every completed round makes **at most 5** Gemini calls. Verified in code (COST-01, already shipped):

| Call | Source | Mode | Count | Note |
|------|--------|------|-------|------|
| Greeting | `api/court-greeting.js` | `greeting` | **1** | Cold-start greeting = **0** (deterministic, no model call). |
| Judge | `api/court-judge.js` | `judge` | **≤ 3** | One per turn, hard 3-turn cap (`MAX_TURNS = 3`). |
| Summarizer | `api/court-record-round.js` | `summarizer` | **1** | Terminal round only. |
| **Total** | | | **≤ 5** | **MAX 5 Gemini calls per completed round (D-08).** |

This is the model-agnostic ceiling: it holds regardless of price. The 3-turn cap is the primary economic bound; the ≤5 envelope is what the gate below asserts.

---

## 2. The GATE (model-agnostic) + the pinned budget

The cost gate is stated in **tokens**, not dollars, so it survives a price change:

```
GATE:  avg calls/round ≤ 5           (the envelope above)
  AND  avg total_tokens/DAU ≤ BUDGET_TOKENS
```

**`BUDGET_TOKENS = 20000` — PROVISIONAL. Refine against the live baseline.**

**How the provisional number was pinned (from the envelope, not measured):**
- A judge call carries the full baseline system prompt + the framed scene + the player reply + the rubric directive, and returns a small structured JSON reaction plus a `thinkingLevel:'low'` thought budget. Estimate ≈ 2.5–3.5K total tokens/judge call.
- Greeting and summarizer calls are lighter (≈ 1–2K total tokens each).
- A worst-case completed round (3 judged turns + greeting + summarizer) ≈ `3×3K + 2×1.5K` ≈ **12K tokens**, with headroom to ~15K for long replies/scenes.
- Assuming ~1 completed round / DAU / day (a **daily** game — one scored round per player per day by the `court_rounds` replay lock), the per-DAU token draw ≈ the per-round draw. **20,000 tokens/DAU/day** sits just above the worst-case single-round envelope, leaving margin for the rare multi-interaction day without hiding a runaway.
- **This is a ceiling to measure against, not a measured baseline.** Run `node scripts/cost-ledger.mjs --days 7` once real traffic accrues and re-pin `BUDGET_TOKENS` to `~1.3×` the observed `tokens/DAU` p90. Mark the refined value with its measurement date.

**Reporting both numbers:** the ledger reports the **token tally** (durable, model-agnostic — the gate) AND the **$ translation** (model-specific — the business number). The token tally is the one that does not rot.

---

## 3. The $ translation (gemini-3.5-flash, verified pricing)

**Pricing — VERIFIED 2026-07-01 at https://ai.google.dev/gemini-api/docs/pricing.**
**⚠️ D-08: pricing ages in months, not years. RE-VERIFY at that URL at execution time and bump `PRICING_VERIFIED_ON` in `scripts/cost-ledger.mjs`.**

| Model | Input ($/1M tok) | Output ($/1M tok) | Role |
|-------|------------------|-------------------|------|
| **gemini-3.5-flash** | **$1.50** | **$9.00** | Primary (judge + greeting + summarizer). The ledger prices the aggregate at THIS rate. |
| gemini-2.5-flash (fallback) | $0.30 | $2.50 | Cheaper fallback. Cost is **dominated by 3.5-flash + thoughts tokens.** |

**Thoughts/thinking tokens are billed at the OUTPUT rate** (confirmed at the pricing page + the thinking docs). `normalizeTokenUsage` folds `thoughtsTokenCount` into the token columns; the $ formula bills them at output:

```
per-call $ = prompt_tokens/1e6 * 1.50  +  (output_tokens + thoughts_tokens)/1e6 * 9.00
per-DAU $  = Σ(per-call $) ÷ distinct court_rounds.player_id that day
```

**Worked $ at the provisional budget (gemini-3.5-flash):** a 20,000-token DAU whose split is ~70% input / ~30% output+thoughts (structured JSON output is small; prompts dominate) ≈ `14000/1e6*1.50 + 6000/1e6*9.00` ≈ `$0.021 + $0.054` ≈ **~$0.075 / DAU / day** as the ceiling. The live `cost-ledger.mjs` prints the actual per-DAU $ from real token rows (do not treat this worked figure as measured — it is the ceiling arithmetic). Because the fallback model is ~5–3.6× cheaper, any fallback traffic only pushes the real number BELOW this 3.5-flash ceiling.

---

## 4. The per-DAU method (why obs stays player-anonymous — D-07)

`yapoleon_observability_events` has **NO `player_id` column — by design.** A token row is never joined to a player identity; that is the no-PII / COPPA-safe posture. So the per-DAU **denominator** does not come from the obs table.

**Denominator = distinct `court_rounds.player_id` per day** (an aggregate ÷ a headcount, never a per-player token join):

```sql
-- token/$ aggregate: grouped by calendar day + mode (status_code = 200)
select date_trunc('day', created_at) as day, mode,
       count(*) as calls,
       sum(prompt_tokens)  as in_tok,
       sum(output_tokens)  as out_tok,
       sum(thoughts_tokens) as think_tok,
       sum(total_tokens)   as total_tok
from yapoleon_observability_events
where created_at >= now() - interval '7 days' and status_code = 200
group by 1, 2;
-- $ = in_tok/1e6*1.50 + (out_tok+think_tok)/1e6*9.00   (gemini-3.5-flash, verified 2026-07-01)

-- DAU denominator: distinct players per day, from court_rounds (NOT obs)
select day, count(distinct player_id) as dau
from court_rounds
group by day;

-- per-DAU = (aggregate token/$ for the day) ÷ (that day's distinct-player count)
```

`scripts/cost-ledger.mjs` performs exactly this: it reads the obs rows (reusing the service-role read path of `api/_yapoleon-observability.js` — no new writer, D-08), groups by day + mode, translates to $, reads `court_rounds` for the distinct-player-per-day count, and divides. **It never carries a `player_id` into the token aggregate.** (Time-axis note: obs is timestamped `created_at`; `court_rounds` is keyed by an integer `day` from `getDayNumber()` — the script exposes both the per-calendar-day token table and the raw DAU-by-`day` map so the divide is transparent; over a steady window they align day-for-day.)

**Running it:**
```bash
node scripts/cost-ledger.mjs            # last 7 days, human-readable
node scripts/cost-ledger.mjs --days 30  # wider window
node scripts/cost-ledger.mjs --json     # machine-readable (for a dashboard/CI check)
# requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (server-only; never VITE_)
```

---
