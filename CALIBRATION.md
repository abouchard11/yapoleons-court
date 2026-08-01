# Fair Fight Win-Rate Calibration (Plan 01-06, D-07)

**Date:** 2026-06-15 · **rubricVersion:** `fairfight-v1` · **Status:** ✅ superseded by
[`CALIBRATION-v2.md`](./CALIBRATION-v2.md), which is what ships today.

> **Read this first.** This document is the **v1** calibration and is kept as the method
> of record: it is where the curve was fit, where the mean-vs-median finding was made, and
> where the fixed-mold defense was first validated. The **curve below is byte-unchanged in
> production** — v2 changed only the prompt-side scoring, then re-measured.
>
> **The number that ships is v2's, not v1's.** Under `fairfight-v2` the representative
> (mean mid) win-rate measured **72.2%**, not the 62% quoted throughout this file. See
> [`CALIBRATION-v2.md`](./CALIBRATION-v2.md) for the live re-measurement and the five
> anti-gaming probes.

The GSD-validated fairness gate (must-nail #1): the Fair Fight judge tuned so a
representative effort wins inside the target band, better replies win more (learnable),
and no fixed rhetorical mold can win every day (the daily weight-shift is a real
structural defense — D-03). Tuned the **server-owned** knob only (the favor curve); the
model never emits the delta (JUDGE-03).

## The locked curve

```
favorDelta = mapToBand(weighted)
mapToBand(weighted) = round(-28 + 80 * weighted)      // weighted ∈ [0,1]  →  delta ∈ [-28, +52]
weighted = Σ_axis clamp01(axisScores[axis]) * dayWeights[axis]
```

- Stamped `fairfight-v1` in `src/judge.ts` **and** `api/court-judge.js` (byte-equivalent — the live game scores on the same curve the calibration used) and on all 30 `DemandRecord`s in `src/demands.ts`.
- **Solvability invariant holds:** max delta `+52 × 3 turns = 156 ≥ 100` (METER-03), with margin.
- Change from the v0 first-guess (`-20 + 75w`): a downward shift of the floor + slope so a middling reply is no longer an automatic win.

## Headline result — the representative (mid) player wins ~62%

| Metric | Value | In target? |
|---|---|---|
| **Mean / overall mid win-rate** | **62.2% pooled** (61.1% and 63.3% across two independent live runs) | ✅ 55–70% |
| Weak archetype | **0%** | lazy/grovel loses |
| Strong archetype | **96%** | great replies win |
| Learnable (strong > mid > weak) | **yes** (96% > 62% > 0%) | ✅ |
| Fixed-mold off-axis win-rate | **0%** | ✅ a single mold loses (D-03) |

### Per-bucket (pooled, fairfight-v1)

| Bucket | weak | mid | strong | fixed-mold |
|---|---:|---:|---:|---:|
| audacity | 0% | 50% | 100% | 0% |
| economy | 0% | 69% | 100% | 0% |
| specificity | 0% | 92% | 83% | 0% |
| flattery-calibration | 0% | 47% | 97% | 0% |
| wit | 0% | 53% | 97% | 0% |

The flattery-calibration days (where naked grovel must lose) sit at mid **47%** — the
capped flattery weight does its job. The fixed mold loses **0%** on every bucket.

## Why mean, not median (an honest finding)

The plan's literal acceptance criterion was "**median** win-rate in 55–70%." That target
is **not achievable, and not meaningful, for this demand set** — and the reason is a real
property, not a tuning failure:

- The per-demand mid win-rate is **bimodal**: with a *fixed* mid-archetype reply per
  demand, that reply is either clearly winning-quality or clearly losing-quality against
  its demand. Across 30 demands, only **~1** lands "contested" (mid-win 34–66%); the rest
  saturate near **0%** or **100%**.
- A bimodal distribution has a **degenerate median**: it jumps discretely between ~0% and
  ~100% as the curve threshold moves — an offline sweep of hundreds of curves found **zero**
  with a median in 55–70%. The median is also unstable run-to-run (a v0 capture-fit
  predicted a 67% median; a live run landed 83%).
- The **mean / overall** mid win-rate is smooth, tunable, and **stable** (61.1% vs 63.3%
  across two independent live runs). It is the meaningful "representative win-rate" and is
  what real players (who vary their reply quality) experience in aggregate.

This is consistent with RESEARCH §B: *"fairness is shared inputs + win/loss + turns +
quantized bands, NOT identical floats … a 55–70% median **with a sane spread** is the bar
— do NOT chase a point value."* We calibrate the stable central tendency (mean 62%, tight
spread) and report the distribution rather than chasing a degenerate point statistic.

> **Operator decision at sign-off:** accept the mean/overall mid win-rate (62%) as the
> calibration metric (recommended), **or** request a future pass that re-authors the 30
> mid-archetype replies to be uniformly borderline so the *median* becomes meaningful
> (larger effort; would not change the game's fairness, only the statistic). The game's
> fairness properties (representative ~62%, weak 0%, strong 96%, mold loses) hold either way.

## Methodology — capture-once, fit-offline

1. **Simulator** (`scripts/yapoleon-calibrate.ts`, forked from yapword's harness): for each
   of the 30 demands × {weak, mid, strong} + a fixed-mold probe, play 3-turn rounds using
   authored archetype replies against the **real live judge** — `gemini-3.5-flash`, flat
   `responseMimeType`/`responseSchema`, temp 0.2, `thinkingLevel: low` — byte-equivalent to
   `api/court-judge.js`. The server-side delta (`deriveFavorDelta`) is applied; the model
   never returns it.
2. **Capture:** each round records the judge's **raw axisScores per turn**. Because raw
   scores are curve-independent, candidate curves are then swept **offline** (free) instead
   of via repeated expensive live runs.
3. **Validation of the offline model:** replaying the v0 curve offline reproduced the live
   v0 result **exactly** (offline median 1.000 = live median 1.000) — so offline curve
   predictions are trustworthy.
4. **Fit:** pooled **6 runs/cell** (two full live runs, raw scores merged) and swept linear
   + eased curves. `-28 + 80w` centered the mean-mid at ~62% with the best learnability
   separation. Confirmed stable by applying it offline to each run independently (61.1% /
   63.3%).
5. **Runs/cost:** ~3,240 live judge calls across the three full runs (two v0/v1 captures +
   the v1 confirmation), **0 errors**. Parallelized at concurrency 6 (~13 min/run).

## Verification

- `npx vitest run` → **76/76 pass** (judge boundary tests updated to the −28/+52 band).
- `npm run build` + `npx tsc --noEmit` → clean.
- `fairfight-v1` stamped in `src/judge.ts` (`RUBRIC_VERSION`), `api/court-judge.js`, and all 30 demands.

## Locked values

| | |
|---|---|
| Curve | `round(-28 + 80 * weighted)` |
| Delta band | `[-28, +52]` |
| Win threshold | favor ≥ 100 within 3 turns; floor 0 |
| rubricVersion | `fairfight-v1` |
| Representative (mean mid) win-rate | **62%** (spread 61–63%) |
