// ─────────────────────────────────────────────────────────────────────
//  The demand bank (CONT-01/02/03) — the FULL 30-demand calibration set
// ─────────────────────────────────────────────────────────────────────
// A static TS bundle (RESEARCH §E): the daily select is a pure client function
// with zero network on the critical path, identical for every player (JUDGE-02),
// and trivially deterministic (CONT-02). Promote to a Supabase table later only
// if hot-swap without an app release is needed (out of scope now).
//
// D-01: This is the full 30-demand calibration set — the exact substrate the
// Fair Fight 55–70% median win-rate calibration gate (Plan 01-06) runs against.
// It replaces the 2–3-record seed bank from the Walking Skeleton.
//
// D-02 (authoring workflow): the author drafted these 30 scenes directly in
// Yapoleon's voice (using src/prompts/yapoleon.ts as the canonical register) →
// the author voice-reviews ONCE (Plan 01-04 Task 3) before they count as shippable
// (CONT-01). NOT cron-LLM-generated; NOT hand-authored-daily. (The live
// scripts/yapoleon-lab.ts render path is offline-by-default because the only
// GEMINI_API_KEY is at its monthly spend cap — the scenes are authored text,
// reviewable as-is via the lab's review sheet.)
//
// D-03 (structural-template defense): the 30 deliberately span distinct
// axis-weight profiles so NO fixed rhetorical mold wins every day — the daily
// weight-shift is a real defense, not cosmetics. Six per bucket:
//   • audacity-heavy      (audacity ≥ 0.35) — reward nerve, punish timidity
//   • economy-heavy       (economy  ≥ 0.35) — reward brevity, punish rambling
//   • specificity-heavy   (specificity ≥ 0.35) — reward the precise, punish the generic
//   • flattery-calibration(flattery dominant but CAPPED ≈0.30) — flattery matters
//        yet NAKED GROVEL LOSES: the off-axes still carry enough that pure
//        sycophancy tanks the turn (the days the design's anti-Suck-Up posture
//        is most load-bearing).
//   • wit-heavy           (wit      ≥ 0.35) — reward the quotable turn
// Off-axes sit at a floor; each vector sums to ~1.0 (±0.001, enforced by test).
//
// The statue demand (id 'wit-statue-golden') reproduces the design's worked
// example — the golden-path reference round.

import { getDayNumber, scramble } from './daily';
import type { Axis } from './judge';

export interface DemandRecord {
  id: string;                        // stable id (for logging / rubric audits)
  scene: string;                     // the framed demand, in Yapoleon's voice (the "scene")
  axisWeights: Record<Axis, number>; // the day's emphasis (D-03) — sums to ~1.0; drives deriveFavorDelta
  rubricVersion: string;             // CONT-03 + the calibration stamp
  tier: 'fairfight';                 // launch tier only
}

// The rubric version every demand is stamped with (CONT-03), flowing to
// court_rounds.rubric_version per round. Bumped to fairfight-v2 (Phase 2: JUDGE-04/06
// hardening) — the prompt-side scoring changed (flattery scores lower, injection docks),
// so the per-round audit trail records v2; the favor curve math is unchanged (CALIBRATION.md).
const RUBRIC = 'fairfight-v2';

// Exported alias for the rubric-invariant guard (Codex F5): src/judge.ts
// RUBRIC_VERSION and this stamp are two independent authorities for the SAME
// rubric label and must never silently diverge. The test asserts strict equality.
export const DEMAND_RUBRIC_VERSION = RUBRIC;

// ── The 30 authored demands, grouped by D-03 bucket ──
export const DEMANDS: DemandRecord[] = [
  // ── audacity-heavy (6) — nerve over niceness; the timid reply loses ──
  {
    id: 'audacity-most-dangerous',
    scene:
      "The Emperor is bored, and a bored Emperor is a dangerous audience. " +
      "'Tell Yapoleon the one thing no one at this court has the spine to say to his face. " +
      "Flinch, and you have already lost him.'",
    axisWeights: { wit: 0.2, specificity: 0.15, audacity: 0.45, economy: 0.1, flattery: 0.1 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'audacity-correct-the-emperor',
    scene:
      "'Yapoleon is never wrong,' he announces, 'which makes the next part difficult. " +
      "Correct him on something — anything — and be right enough that he cannot have you removed for it.'",
    axisWeights: { wit: 0.2, specificity: 0.15, audacity: 0.4, economy: 0.1, flattery: 0.15 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'audacity-demand-something',
    scene:
      "He leans back, amused already. 'Everyone who enters this room wants something and pretends they do not. " +
      "Skip the pretending. Demand something of Yapoleon outright — and make the nerve of it worth more than the asking.'",
    axisWeights: { wit: 0.15, specificity: 0.15, audacity: 0.45, economy: 0.15, flattery: 0.1 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'audacity-unforgivable-opinion',
    scene:
      "'Yapoleon has heard every safe opinion twice today and survived none of them. " +
      "Give him one he is supposed to find unforgivable — and dare to mean it, or do not bother standing there.'",
    axisWeights: { wit: 0.2, specificity: 0.1, audacity: 0.5, economy: 0.1, flattery: 0.1 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'audacity-refuse-him',
    scene:
      "'A small test,' he says, far too pleased. 'Yapoleon will ask you for something, and you will refuse him — " +
      "to his face, and so well that he respects the refusal more than he would have respected the obedience.'",
    axisWeights: { wit: 0.2, specificity: 0.15, audacity: 0.4, economy: 0.15, flattery: 0.1 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'audacity-bet-against-him',
    scene:
      "'Yapoleon has never lost a wager he was willing to admit to,' he says. 'Propose one he might actually lose. " +
      "Cowardice in the stakes will cost you more than the loss ever could.'",
    axisWeights: { wit: 0.2, specificity: 0.15, audacity: 0.45, economy: 0.1, flattery: 0.1 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },

  // ── economy-heavy (6) — brevity is the demand; rambling loses Yapoleon ──
  {
    id: 'economy-one-breath',
    scene:
      "The Emperor lifts a single finger. 'Yapoleon has exactly one moment to spare, and you have spent half of it arriving. " +
      "Say the whole of it in the other half — and not one word he could have removed without missing it.'",
    axisWeights: { wit: 0.2, specificity: 0.15, audacity: 0.1, economy: 0.45, flattery: 0.1 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'economy-five-words',
    scene:
      "'Yapoleon will grant you five words,' he says, 'and he will count them. " +
      "Win him in five, or learn that a sixth is its own confession of weakness.'",
    axisWeights: { wit: 0.25, specificity: 0.15, audacity: 0.1, economy: 0.4, flattery: 0.1 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'economy-no-throat-clearing',
    scene:
      "'Most courtiers spend their first sentence apologizing for the second,' he sighs. " +
      "'Spend none of yours. Begin where it matters and stop the instant it stops mattering — Yapoleon will notice the difference.'",
    axisWeights: { wit: 0.2, specificity: 0.15, audacity: 0.1, economy: 0.45, flattery: 0.1 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'economy-one-sentence-life',
    scene:
      "'Summarize your entire worth in a single sentence,' he commands, 'and make the brevity itself the argument. " +
      "A second sentence tells Yapoleon you did not believe the first.'",
    axisWeights: { wit: 0.2, specificity: 0.2, audacity: 0.1, economy: 0.4, flattery: 0.1 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'economy-cut-it-shorter',
    scene:
      "'Whatever you were going to say,' he interrupts before you have said it, 'say half. " +
      "Then look at the half you kept and cut it again. What survives twice is the only part Yapoleon wanted.'",
    axisWeights: { wit: 0.2, specificity: 0.15, audacity: 0.1, economy: 0.45, flattery: 0.1 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'economy-the-toast',
    scene:
      "He raises an empty glass. 'Toast Yapoleon. One line — the kind a room repeats afterward without being asked. " +
      "Pad it and the room forgets it before the glass is down.'",
    axisWeights: { wit: 0.25, specificity: 0.1, audacity: 0.1, economy: 0.4, flattery: 0.15 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },

  // ── specificity-heavy (6) — the precise, observed detail; generalities lose ──
  {
    id: 'specificity-one-true-thing',
    scene:
      "He narrows his eyes. 'Everyone flatters Yapoleon in generalities, which is to say everyone flatters no one. " +
      "Name the single precise thing about his reign that you, and only you, have actually noticed.'",
    axisWeights: { wit: 0.15, specificity: 0.45, audacity: 0.15, economy: 0.15, flattery: 0.1 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'specificity-the-detail',
    scene:
      "'Describe this hall,' he says, gesturing at nothing in particular. " +
      "'But Yapoleon warns you: name the one detail no visitor remembers, and he will know at once whether you looked or merely arrived.'",
    axisWeights: { wit: 0.15, specificity: 0.45, audacity: 0.1, economy: 0.2, flattery: 0.1 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'specificity-not-the-obvious',
    scene:
      "'Praise Yapoleon's mind,' he allows, 'but not the obvious part — anyone can see the obvious part, that is what makes it obvious. " +
      "Find the cleverness that hides, and prove you found it with a detail he did not hand you.'",
    axisWeights: { wit: 0.2, specificity: 0.45, audacity: 0.1, economy: 0.15, flattery: 0.1 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'specificity-the-small-tell',
    scene:
      "'Yapoleon has a habit he believes no one has caught,' he says, with the confidence of a man who is wrong. " +
      "'Guess it — precisely, not a category but the very thing — and he will pretend you did not.'",
    axisWeights: { wit: 0.2, specificity: 0.45, audacity: 0.15, economy: 0.1, flattery: 0.1 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'specificity-name-the-moment',
    scene:
      "'History will remember Yapoleon for a great many things,' he says, 'most of which he arranged himself. " +
      "Name the exact moment it should remember instead — a specific one, with the corner of it intact, not a vague golden age.'",
    axisWeights: { wit: 0.15, specificity: 0.45, audacity: 0.15, economy: 0.15, flattery: 0.1 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'specificity-the-flaw',
    scene:
      "'Yapoleon will permit one criticism today,' he says, 'on the condition that it is exact. " +
      "Name a precise fault — the kind only a careful eye finds — and he may, briefly, respect the eye more than he resents the fault.'",
    axisWeights: { wit: 0.2, specificity: 0.4, audacity: 0.2, economy: 0.1, flattery: 0.1 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },

  // ── flattery-calibration (6) — flattery weighted but CAPPED; naked grovel LOSES.
  //    Flattery is the dominant axis (≈0.30) yet the off-axes (wit/specificity/
  //    audacity) still carry ≈0.70 together — so a reply that ONLY grovels scores
  //    high on a 0.30 axis and zero on 0.70 of the weight, and tanks the turn. The
  //    winner flatters WITH wit/specificity/nerve; the sycophant alone is dismissed.
  {
    id: 'flattery-praise-without-grovel',
    scene:
      "'Praise Yapoleon,' he says, and the room tenses, because they have all failed this before. " +
      "'But the moment it curdles into grovelling, he stops listening — and he can hear the curdle a full sentence before you can.'",
    axisWeights: { wit: 0.25, specificity: 0.25, audacity: 0.15, economy: 0.05, flattery: 0.3 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'flattery-compliment-with-teeth',
    scene:
      "'Compliment Yapoleon,' he allows, 'but leave a little tooth in it. " +
      "A compliment with no edge is just fear wearing a smile, and fear has never once amused him.'",
    axisWeights: { wit: 0.25, specificity: 0.2, audacity: 0.2, economy: 0.05, flattery: 0.3 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'flattery-earned-not-poured',
    scene:
      "'You may admire Yapoleon,' he says, 'but admiration poured by the bucket is worth what a bucket is worth. " +
      "Make him believe the admiration was EARNED by something specific — or keep the bucket.'",
    axisWeights: { wit: 0.18, specificity: 0.28, audacity: 0.16, economy: 0.06, flattery: 0.32 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'flattery-the-honest-kind',
    scene:
      "'Yapoleon has been flattered by professionals,' he says, unmoved. 'Try the rarer thing: praise that sounds like you would say it whether or not he were listening. " +
      "The instant it sounds rehearsed, you have told him you do not believe it either.'",
    axisWeights: { wit: 0.2, specificity: 0.25, audacity: 0.2, economy: 0.05, flattery: 0.3 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'flattery-without-the-word-great',
    scene:
      "'Tell Yapoleon he is magnificent,' he says, 'without using a single word a courtier would use. " +
      "Reach for the cheap superlative and he will know you reached for the nearest one, not the true one.'",
    axisWeights: { wit: 0.25, specificity: 0.25, audacity: 0.15, economy: 0.05, flattery: 0.3 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'flattery-the-backhand',
    scene:
      "'Flatter Yapoleon by insulting everyone else,' he proposes, delighted with himself. " +
      "'But make the insult clever and the flattery true — grovel at his feet while you do it and he will simply step over you.'",
    axisWeights: { wit: 0.28, specificity: 0.2, audacity: 0.15, economy: 0.05, flattery: 0.32 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },

  // ── wit-heavy (6) — the quotable turn; the golden-path statue lives here ──
  {
    id: 'wit-statue-golden',
    scene:
      "He gestures, without rising, to the marble likeness of himself dominating the hall. " +
      "'A new statue of Yapoleon was unveiled this morning. Say something about it worth carving underneath — " +
      "and remember he has heard “beautiful” from better mouths than yours.'",
    axisWeights: { wit: 0.45, specificity: 0.25, audacity: 0.15, economy: 0.1, flattery: 0.05 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'wit-amuse-or-leave',
    scene:
      "'Yapoleon is bored,' he says, the most dangerous two words he owns. " +
      "'Amuse him. Not pleasantly — properly. The kind of line he repeats tomorrow as if he thought of it.'",
    axisWeights: { wit: 0.5, specificity: 0.15, audacity: 0.15, economy: 0.15, flattery: 0.05 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'wit-finish-his-thought',
    scene:
      "'Yapoleon began a thought this morning and lost interest in finishing it,' he says. " +
      "'Finish it for him — wittier than he would have, which is a tall order, and he will be watching the height.'",
    axisWeights: { wit: 0.45, specificity: 0.2, audacity: 0.15, economy: 0.15, flattery: 0.05 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'wit-the-better-insult',
    scene:
      "'The court jester was dismissed for being merely funny,' he says, 'which is the worst kind. " +
      "Insult the jester for Yapoleon — cleverly enough that the Emperor wishes he had said it first.'",
    axisWeights: { wit: 0.5, specificity: 0.15, audacity: 0.2, economy: 0.1, flattery: 0.05 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'wit-pun-worth-keeping',
    scene:
      "'Yapoleon despises a bad pun,' he says, 'and adores a good one, and the distance between them is the whole of your problem. " +
      "Make one good enough that he forgives himself for laughing.'",
    axisWeights: { wit: 0.5, specificity: 0.15, audacity: 0.15, economy: 0.15, flattery: 0.05 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
  {
    id: 'wit-turn-the-weather',
    scene:
      "'It is raining,' he observes, 'which even Yapoleon has not yet found a way to take credit for. " +
      "Say something about the rain that earns its place in a room this clever — the dull remark dies on the threshold.'",
    axisWeights: { wit: 0.45, specificity: 0.2, audacity: 0.15, economy: 0.15, flattery: 0.05 },
    rubricVersion: RUBRIC,
    tier: 'fairfight',
  },
];

// Deterministic daily select (CONT-02) — mirrors the fork source's getDailyWord.
// Stable shuffle so consecutive days don't walk the list in order. No
// per-difficulty offset (launch is Fair Fight only). Identical for every player
// on a given day (JUDGE-02): a pure function of the day number, zero network.
export const selectDailyDemand = (day: number = getDayNumber()): DemandRecord =>
  DEMANDS[scramble(day) % DEMANDS.length];
