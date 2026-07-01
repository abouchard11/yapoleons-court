# Milestone 1 — Kill-Criteria & Validation Instrumentation (VAL-03 / VAL-04)

**Owner:** the operator deciding Milestone 1's go/no-go.
**Status:** PROVISIONAL — reference-anchored, readiness-gated; refined on the first mature cohort.
**Analytics home:** PostHog **project `469777`** ("Yapword" org "MidnightDev"). GA4 property `538728082` stays for **acquisition** only (D-11). Every VAL event carries the anonymous `court_rounds.player_id` as a property — opaque, no PII (SAFE-03 / COPPA). **Invariant: never join PII to `player_id` downstream** (a later "enrichment" must not quietly turn the analytics id into PII).

> **Why this doc exists (Runtime State Inventory).** The retention cohorts, the share funnel, and the six turn-count diagnostics are **PostHog UI insight/cohort definitions** — they live in the PostHog project, **not in git**. If the project were lost or rebuilt, nothing in the repo would reconstruct them. **This document is their reproducible source of truth.** Every insight below is specified precisely enough to rebuild by hand in the PostHog UI.

---

## 0. The events these criteria read (wired in Plan 04-04)

All fire client-side through the `trackEvent` dual-emit bridge (`src/gemini-client.ts` → PostHog + GA4 + native), each with `player_id: getPlayerId()`:

| Event | Fires | Properties | Source |
|-------|-------|------------|--------|
| `round_started` | a fresh playable round resolves (once; not on a replay-blocked re-open or a resumed mid-round) | `player_id`, `day`, `tier:'fairfight'` | `src/RoundScreen.tsx` mount effect |
| `turn_submitted` | each of turns 1–3, at submission **before** the judge await (counts the attempt even if the judge throws) | `player_id`, `turn_index` (0-based, pre-turn), `reply_length` (a **number** — never the reply text) | `src/RoundScreen.tsx` `submitTurn` |
| `round_completed` | a **terminal** `applyTurn` (won/lost) only — **never** on a SAFE-02 moderation-flagged turn (the judge throws → brush-off, no `applyTurn`) | `player_id`, `outcome` (`won`\|`lost`), `turns_used`, `final_favor` | `src/RoundScreen.tsx` `submitTurn` |
| `card_generated` | the share card blob is drawn (reliable — a render failure throws first, so it never fires on a failed draw) | `player_id`, `outcome`, `turns_used` | `src/share.ts` `shareVerdict` |
| `share_attempted` | the OS share sheet is invoked **or** the desktop download fires, **before** the await (best-effort — a user-cancel does not un-count it) | `player_id`, `outcome`, `method` (`os_share`\|`download`) | `src/share.ts` `shareVerdict` |

**Identity (VAL-01):** `posthog.identify(getPlayerId())` — no person-props — fires from **both** `src/main.tsx` (returning player, id already in storage at load) **and** `src/RoundScreen.tsx` after `ensureIdentity()` resolves (first launch, id minted async). With `person_profiles: 'identified_only'` set in `main.tsx`, **retention cohorts are silently empty until `identify` runs**, so the two-call-site fix is what makes the first-launch (new-player) D1 cohort measurable at all (Pitfall 4).

**D-12 honesty rule (repeat, because it drives the denominator):** `card_generated` is the **reliable** metric (the blob was drawn) → it is the kill-criteria **denominator**. `share_attempted` is **best-effort** (`navigator.share` resolves on sheet-**open**, not send) → **directional only**. **Never label `share_attempted` "confirmed shares."**

---

## 1. The kill-criteria floors (VAL-03 — PROVISIONAL)

These are **failure signals, not targets**. Crossing a floor (once its readiness gate is satisfied) is evidence the corresponding bet failed. They are reference-anchored to published casual/puzzle retention (puzzle D1 ~32%, D7 ~12–14%; casual top-titles D7 ~14–15% in 2025 — RESEARCH A3), so a floor set **below** the ordinary band is a genuine *failure* read, not a normal value. **All three are provisional and are refined against the first mature live cohort (D-13).**

| # | Floor | Threshold | Meaning if crossed (gate satisfied) | Maturity |
|---|-------|-----------|--------------------------------------|----------|
| **PRIMARY** | D7 retention | **< ~8%** after two content pushes (a mature cohort) | The retention bet fails → **Milestone-1 no-go** | Lagging (matures last) |
| **EARLY-WARNING** | D1 retention | **< ~20%** | Leading signal the loop may not be sticky; not a standalone no-go, prompts investigation | Leading |
| **SHARE-LOOP-DEAD** | `card_generated` per completed round | **< ~5%** of completed rounds | The share loop is dead (few players even generate a card) → the organic-spread bet fails | Fast-maturing |

**Notes.**
- The share-loop floor uses **`card_generated` / `round_completed`**, NOT `share_attempted` (D-12 / A6). `share_attempted` is reported alongside as directional colour only.
- "After two content pushes" for D7 is deliberate: a cohort must see enough fresh demands to have a fair chance to return before its non-return counts as churn.
- The D7 floor is the only one wired to a **go/no-go**. D1 and the share floor are diagnostic pressure signals.

---

## 2. The readiness gate (the load-bearing precondition — noise-proof)

**A floor is NOT evaluated until its readiness gate is satisfied.** This is the mechanism that stops a "kill" (or a false all-clear) from firing on the ~4-day-old, single-digit-per-cell data (PostHog began 2026-06-14). Triggers tie to a **sample threshold, not a calendar window** (turn-count design §51): "we have enough data," never "it's been N days."

**Gate (both conditions required on every floor):**

- **≥ N completed rounds per cell**, where a *cell* is the smallest bucket a given view slices to (e.g. skill-bin × turns-used for the win-rate view). This guards the **per-cell** diagnostics.
- **≥ M D7-eligible players in the cohort**, where *D7-eligible* = a player whose first `round_started` is ≥ 7 days ago (so a D7 return is even possible). This guards the **retention** floors.

### Pinned provisional values (the author's discretion per Open Question 3 — refine against the live baseline)

- **N = 30 completed rounds per cell.**
- **M = 100 D7-eligible players.**

**Rationale.** At yapword's scale (~**77 active / 7 days**), the funnel filters **completers → winners → three turn-buckets → a D7 flag**, which yields **single-digit per-cell n** — exactly the regime where a naive threshold trips or suppresses a floor on noise (Pitfall 5).

- **N = 30** is the conventional small-sample floor at which a binomial proportion begins to stabilise (the familiar *n ≥ 30* rule of thumb). Below it, a per-cell win-rate or abandonment rate is dominated by sampling noise and must not be read as signal.
- **M = 100** keeps the standard error of an ~8% D7 rate near **√(0.08·0.92 / 100) ≈ 2.7%** (95% CI ≈ ±5.3%). That is still coarse, but it is the **minimum credible cohort**: it lets a genuinely-failing reading (e.g. ~3–4%) be distinguished from the ~8% floor rather than sitting inside a noise band that straddles it. Below M ≈ 100 the CI is wide enough that an ~8% floor and a "healthy" ~14% value are statistically indistinguishable — so evaluating there would be noise.

**Both values are provisional and marked _refine-against-the-live-baseline_.** Re-pin them once the first real cohort exists: if the live per-cell fill rate is slower than the yapword anchor implies, N and M rise; if faster, they may relax. Until then, treat any floor whose gate is unmet as **"not yet evaluable,"** not as "passing."

**Lean actionable triggers on the fast-maturing views** (win-rate skill-binned, abandonment-by-turn) and **treat retention (D7 / outcome×retention) as lagging** — it depends on VAL-01 cohort maturity (~1–2 weeks post-instrumentation) and matures last.

### Accepted MVP risk (stated explicitly)

The launch cohort may be **damaged before detection has power.** PostHog began 2026-06-14, so D7 will not mature until well into the validation window; if the round is (say) too hard, the launch cohort is likely harmed *before* the readiness gate for the D7 floor is even satisfied. **No pre-launch step fixes detection latency** (turn-count design §85). This is an accepted Milestone-1 risk, mitigated only by keeping the cap **cheap to change** for *subsequent* cohorts (VAL-04: `MAX_TURNS` is a config flag — value stays 3 — so a reactive re-cal flips a flag, not a code edit).

---

## 3. VAL-01 retention insight (PostHog spec)

Rebuild in the PostHog UI (project `469777`) — **Product analytics → Retention**:

- **Start event:** `round_started`
- **Returning event:** `round_started`
- **Retention type:** **"On or after"** (rolling — correct for a daily game where a D7 return counts even if the player skipped some days).
- **Period:** **Days.** **D1** = the day-1 column; **D7** = the day-7 column.
- **Identity:** cohorts key on the identified `player_id` (VAL-01). Confirm in PostHog that post-identify events show `distinct_id === player_id` (not a PostHog auto-UUID) and that a person profile exists — otherwise `identified_only` is silently dropping the cohort (Pitfall 4).
- **Optional breakdown:** by `outcome` (from a joined `round_completed`) for the outcome×retention view (§4, view 5).

Read the **PRIMARY (D7 < ~8%)** and **EARLY-WARNING (D1 < ~20%)** floors off this insight — but **only once ≥ M = 100 D7-eligible players** exist.

---

## 4. VAL-02 share-rate funnel (PostHog spec)

**Product analytics → Funnel**, ordered, per completed round:

1. `round_completed`
2. `card_generated`
3. *(directional only, do not gate on it)* `share_attempted`

- **Kill denominator:** `card_generated` / `round_completed` → the **SHARE-LOOP-DEAD < ~5%** floor. Use the step-1→step-2 conversion, **not** step-3.
- `share_attempted` (step 3) is shown for colour only — split by `method` (`os_share` vs `download`) to see platform mix. **Never reported as "confirmed shares."**

---

## 5. The six VAL-04 turn-count diagnostic views (PostHog specs)

The 3-turn cap is a **tracked hypothesis** (turn-count gut-check, 2026-06-18): the value stays **3** for M1; these views make it observable so any future change is data-driven. Each is a reproducible PostHog insight. **A fired trigger is an alarm, not a remedy** — the corrective lever (reactive re-calibration, then flip `VITE_MAX_TURNS`) stays cheap; nothing here tests the counterfactual (behaviour under a *different* cap — only a live A/B could, out of M1 scope).

> **Cross-cutting anti-pattern (applies to view 1 especially):** **do NOT compare the live _aggregate_ win-rate to the bare `72.2%` calibration figure.** `72.2%` is the `fairfight-v2` **mid/representative-archetype cell** (1,095 live calls), **not** a population-weighted rate. Comparing a live aggregate to it conflates "the judge is harsher live" with "the live population is weak-skewed" — a **population-mix confound** (turn-count design §37). Always **bin by a skill proxy** and compare **each bin** to its archetype cell (weak 0% / mid 72.2% / strong 96.7%): the synthetic **gradient**, not a single number, is the benchmark.

| # | View | PostHog insight (events · properties · breakdown) | What it can decide |
|---|------|----------------------------------------------------|--------------------|
| **1** | **Win-rate, SKILL-BINNED, segmented by turns-used** | Trend/table over `round_completed`; measure = win-rate = `count(outcome='won') / count(*)`. **Breakdown by a per-player skill-proxy bin** (weak / mid / strong-like) **and** by `turns_used`. The skill proxy is derived from `court_turns` (mean weighted-quality / axis scores / `favor_delta`) — **judge-derived**, so it is paired with the independent effort proxy in view 3. Compare **each bin** to its archetype cell (0% / 72.2% / 96.7%). | Whether live human play matches the synthetic **gradient** per skill bin. **Not** a bare-aggregate-vs-72.2% comparison (that is undecidable — the confound above). |
| **2** | **Turns-to-win distribution** | Over `round_completed` filtered `outcome='won'`; breakdown by `turns_used` (1 / 2 / 3). | Is the 3rd turn **load-bearing or vestigial**? (Most wins landing by turn 2 → the cap is loose = cheaper, acceptable — **note, do not act**.) |
| **3** | **Favor-at-loss + a judge-INDEPENDENT effort proxy** | Over `round_completed` filtered `outcome='lost'`; distribution of `final_favor` bands, **crossed with `reply_length`** (from `turn_submitted.reply_length`, equivalently `court_turns.reply` length — persisted verbatim, aggregate-only, COPPA-safe). | Disambiguate **too-hard** (low favor + *substantive* replies) from **low-effort** (low favor + *degenerate*: empty/one-word/duplicated). `turns_used` + per-turn deltas **alone cannot** separate these — the delta *is* the judge's verdict, the symptom both causes share. The effort proxy is the load-bearing disambiguator. |
| **4** | **Mid-round abandonment, located by turn** | Funnel `round_started → turn_submitted (turn_index=0) → turn_submitted (turn_index=1) → turn_submitted (turn_index=2) → round_completed`; read drop-off **per turn**. Guard against latency/error drops. | Distinguish a drop after **turn 1** (bounce) from a drop after **turn 2** (lost mid-spar) — different turn-count conclusions. A *cap-too-short* signature specifically clusters **after a losing turn-2 at mid favor**. A **candidate pacing signal pending cause-attribution** (network / hard-demand / notification confounds remain), not a clean proof. |
| **5** | **Outcome × retention** | The §3 retention insight, **broken down by `outcome`** (and optionally `turns_used`), joined via `player_id`. | A **lagging, correlational health check — NOT a turn-count decision input.** It cannot isolate the cap from demand difficulty / judge tone / novelty decay, and it depends on VAL-01 cohort maturity. Treat as the VAL-01 cross-reference; matures last. |
| **6** | **Within-round engagement decay (ALL rounds)** | Over `turn_submitted`; average `reply_length` broken down by `turn_index`, **split by `outcome`** (win / loss / abandoned). | **Falling effort from turn 2→3** among losers/abandoners is the direct, cheap signal that **the extra turns aren't landing** — the failure mode the winner-only views (1–2) would miss. |

**Readiness on the diagnostics:** views that slice to per-cell buckets (1, 2, and the winner/loser cross-tabs) require **≥ N = 30 completed rounds per cell** before a cell is read. View 5 additionally requires the **M = 100** cohort. Views 4 and 6 mature fastest (they read the whole funnel / all rounds, not winner-only cells) — lean the actionable pacing triggers there.

### Turn-count review triggers (the VAL-04 alarms — ride alongside the D7 criteria)

Provisional shapes (thresholds refine against the live baseline; every trigger is gated on §2 first):

- **Too-hard-for-humans:** a sustained per-bin win-rate **far below its archetype cell** **AND** low favor-at-loss **conditioned on high-effort replies still losing** (view 1 × view 3 — the high-effort condition is load-bearing; without it the trigger is undecidable) → revisit the curve or +1 turn (reactively).
- **Pacing / spar-not-landing:** high **post-turn-1, low-latency** mid-round abandonment clustered **after a losing turn-2** (view 4, latency-guarded) → revisit.
- **Cap loose (note, do not act):** turn-3 essentially **unused** (most wins land by turn 2, view 2) → the cap is loose = cheaper and acceptable; record, do not change.

---

## 6. Reversibility (VAL-04 — why the alarms are cheap to act on)

`MAX_TURNS` is a config flag (`src/config.ts`, `VITE_MAX_TURNS || 3`; consumed by `src/round.ts`). **The value stays 3 for Milestone 1** (no pre-launch 4-cap re-cal — every signal says 3 is well-tuned, and a pre-built curve is speculative). The **server** caps (`api/court-record-round.js` `MAX_TURNS`, `api/court-judge.js` `MAX_PRIOR`) stay **hardcoded safety clamps** — the client is the tunable, the server clamps (RESEARCH A5). If a trigger above ever fires, the path is: **re-calibrate reactively (≈ an afternoon on the existing harness) → flip the flag** — fast, without pre-paying for a curve we likely won't need.

---

## 7. HARD INVARIANT

All VAL instrumentation is **client-side measurement**. No VAL signal — not an event, not a retention read, not a turn-count trigger — is ever routed into `deriveFavorDelta`, the rubric, or the win threshold. No server judge path is modified by the measurement work. `deriveFavorDelta` lives only in `api/court-judge.js` and is never imported by analytics code.

---

*Provisional — pin N/M and the floors against the first mature live cohort. Insights live in PostHog project `469777`; this doc is their reproducible source of truth.*
