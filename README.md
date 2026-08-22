# Yapoleon's Court

**A daily game where an LLM judges you — but the model can't touch the score.**
Live at **[court.yapoleon.com](https://court.yapoleon.com)**.

Yapoleon is a haughty AI emperor. Each day he poses a framed demand; you answer in free
text; a favor meter and an in-character reaction score you, teach you why, and become the
share. You don't *trick* him into a good score — you *charm* him. His taste is the scoring
function.

The interesting part isn't the prompt. It's that this is a competitive game backed by a
model users are actively trying to game, running on a paid API, in front of minors — so the
whole thing is built so the model **can't be gamed, can't be made to run up an unbounded
bill, and can't say something it shouldn't.** That's the engineering below.

---

## The fairness backbone

The single most important design decision: **the model never emits the score.**

One structured, low-temperature Gemini call per turn returns *taste only* —

```jsonc
// JUDGE_SCHEMA — the model's entire output surface
{
  "axisScores":  { "wit": 0.0-1.0, "specificity": …, "audacity": …, "economy": …, "flattery": … },
  "dominantAxis": "wit | specificity | audacity | economy | flattery",
  "reaction":     "one in-voice line"
}
// note what is ABSENT: there is no favorDelta field.
```

The number the meter moves by is derived **server-side**, by a pure function the model can't
see or reach:

```
model → axisScores (taste)  ─┐
                             ├─►  favorDelta = deriveFavorDelta(axisScores, dayWeights)   ← server owns this
today's axis weights  ───────┘        (clamp each axis to [0,1], weight, map to band)
```

Because the delta is computed from clamped axis scores against that day's weights, a player
who talks the model into "give me 100 favor" changes *nothing* — there is no favor field for
the model to inflate. Prompt injection and sycophancy-gaming can, at most, move the *taste*
scores, and those are bounded, weighted, and re-weighted daily. See
[`api/court-judge.js`](api/court-judge.js) (`deriveFavorDelta`, marked "the fairness backbone").

## Four threats, and how each is structurally handled

**1 — Prompt injection.** The player's reply rides the request as *data being judged*, never
concatenated into the system instruction, so it can't rewrite the judge's rules. The scoring
rubric explicitly treats an attempt to instruct the judge, award itself favor, or extract the
rules as *insolence* — scored low, in character — while distinguishing genuine boldness the
scene invited (which scores well) from an attack on the judging itself. And even a fully
convinced model still can't emit the number (see above).

**2 — Sycophancy-gaming.** Naked flattery scores *low on every axis* by rubric — empty
brevity isn't economy, groveling isn't nerve — so it can't ride a high-weight day to a win.
The axis weights shift daily, so no single winning template survives.

**3 — Denial-of-wallet.** Every layer bounds spend:
- a **3-turn daily cap** is the primary economic ceiling (one player can cost at most 3 model calls/day);
- per-IP and per-user **rate limits** backstop it;
- an in-process **concurrency damper** with a **TOCTOU-safe atomic slot reservation** (the
  check-and-increment run with no `await` between them, so a burst can't all pass the gate
  before any increments) — over the threshold, requests take a cached path;
- a **degrade mode** serves a cached in-voice reaction with **zero model calls** under load,
  and *still* routes a neutral score through `deriveFavorDelta` so the meter never breaks;
- the content pre-filter (below) short-circuits *before* the model call, so flagged input
  costs nothing;
- Vercel Spend Management is the account-level hard stop. Rationale and per-DAU math live in
  [`docs/economics/per-dau-cost-ledger.md`](docs/economics/per-dau-cost-ledger.md).

**4 — Content safety (all-ages, in front of a paid model).** A deterministic red-line
pre-filter ([`api/_sanitize.js`](api/_sanitize.js), `detectRedLines`) runs *before* any model
call:
- **narrow by design** — it flags only genuine red lines (protected-characteristic slurs,
  credible threats/self-harm directives, sexual content involving minors). Ordinary profanity
  passes: roasting the emperor *is* the game; the all-ages bound lives on his *output*, not by
  neutering input.
- **hard to bypass** — leetspeak, unicode homoglyphs, collapsed duplicates, and zero-width /
  combining-mark splits are normalized away before matching (`obscenity` + NFKC + a
  format/combining-mark strip).
- **ReDoS-safe** — a non-backtracking matcher over length-bounded input.
- **privacy-safe** — it returns a coarse *category only*, never the offending text, and the
  flagged reply is never logged or persisted (COPPA posture). A flagged turn is *not* consumed.

The complementary output scanner ([`src/safety/output-scan.ts`](src/safety/output-scan.ts) —
`scanForBannedProfanity` + `targetsPerson`) is used in the test suite to prove the cached
degrade reaction and the emperor's voice stay within the all-ages bound.

## Reliability

The judge proxy treats an unreliable upstream like infrastructure: a model **fallback chain**
(Flash primary → Flash fallback), exponential backoff with jitter on 5xx/timeouts, a 429 that
*returns immediately* so the chain falls through to the next model with the client's full
budget, a non-retryable set that fails fast, and a 9s upstream timeout. A malformed model
response degrades the client to an error state with **no turn consumed** — never a broken
meter. Every outcome is recorded out-of-band via `@vercel/functions` `waitUntil` so
observability never adds latency to the user's request.

## The memory moat

Yapoleon remembers you. A server-side dossier tracks your standing, and two *voice-only*
signals — own-history anti-repeat and rhetorical-shape decay — let him call out a repeated
move in character. Both are computed deterministically, appended to the *same* judge prompt
(zero extra model calls), and — the hard invariant — **never enter the favor math**: a stale
line simply scores low on merit, identically for every player.

---

## Stack

Vite · React · TypeScript · Capacitor (iOS) · Supabase · Vercel serverless functions ·
Google Gemini (server-only proxy — the key is never bundled into client JS) · PostHog + GA4.

## Run it

```bash
npm install
cp .env.example .env.local     # set GEMINI_API_KEY + a Supabase project (server-only keys)
npm run dev                    # vite dev server
npm run build                  # tsc + production build
npm test                       # vitest — includes the judge, safety, and cost-ledger suites
```

All model access is server-side (`/api/*`); no secret is ever exposed to the client.

## Where to look

| Path | What's there |
|---|---|
| [`api/court-judge.js`](api/court-judge.js) | The judge: the fairness backbone, injection isolation, the cost damper, the fallback chain |
| [`api/_sanitize.js`](api/_sanitize.js) | The deterministic red-line content pre-filter |
| [`src/judge.ts`](src/judge.ts) | The client-side favor math (byte-equivalent to the server's) |
| [`src/safety/output-scan.ts`](src/safety/output-scan.ts) | The output-side all-ages scanner (test harness) |
| [`scripts/yapoleon-calibrate.ts`](scripts/yapoleon-calibrate.ts) | The win-rate simulator: 30 demands × {weak, mid, strong} + a fixed-mold probe, against the real live judge |
| [`CALIBRATION.md`](CALIBRATION.md) | v1 — the method of record: how the curve was fit, and why the metric is the mean, not the median |
| [`CALIBRATION-v2.md`](CALIBRATION-v2.md) | v2 — the shipping numbers: live re-measurement + the five anti-gaming probes |
| [`docs/economics/per-dau-cost-ledger.md`](docs/economics/per-dau-cost-ledger.md) | Per-DAU cost model and the spend-cap rationale |
| [`docs/safety/age-rating-posture.md`](docs/safety/age-rating-posture.md) | The content-safety posture |

## How the rubric is calibrated

A rubric that scores *taste* has no reference implementation to grade against, so the
scoring function is validated by its **properties** instead:

| Property | The check | Measured (`fairfight-v2`, live 2026-06-16) |
|---|---|---|
| Learnable | strong > mid > weak must hold | 96.7% > 72.2% > 0% ✅ |
| Fair | a representative player wins inside a target band | 72.2% vs a 55–70% target — ~2.2 pts high, inside 3-run sampling noise |
| Not template-farmable | one fixed rhetorical mold must **lose** on its off-axis days | 0% off-axis ✅ (the negative control) |
| Not gameable | 5 adversarial probes: naked flattery, prompt injection, *legitimate* audacity, delimiter breakout, grovel-on-economy | all PASS live |
| Honest about noise | hosted inference isn't bit-reproducible at low temp | ≥3 runs/cell; the distribution is reported, never a point value |

1,095 judge calls, 0 errors. The favor curve is server-owned and byte-unchanged from v1 —
the model emits only clamped axis sub-scores and never the delta.

Full method in [`CALIBRATION.md`](CALIBRATION.md) (including why the specified *median*
metric turned out to be degenerate) and [`CALIBRATION-v2.md`](CALIBRATION-v2.md).

## Rights

**Proprietary — all rights reserved. No license is granted.** See [LICENSE](LICENSE).
## Related

- [llm-safety-gate](https://github.com/abouchard11/llm-safety-gate) — the fail-closed classifier machine this posture is cousins with
- [graphiti-neo4j-ops](https://github.com/abouchard11/graphiti-neo4j-ops) — hardened Graphiti/Neo4j ops
