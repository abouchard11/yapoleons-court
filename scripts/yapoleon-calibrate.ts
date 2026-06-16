/**
 * yapoleon-calibrate.ts — the Fair Fight WIN-RATE SIMULATOR (Plan 01-06, D-07).
 *
 * FORKED from yapword's scripts/yapoleon-calibrate.ts (a standalone "run N
 * scenarios against Gemini, emit a review sheet" harness) and RE-POINTED into the
 * win-rate simulator the GSD fairness gate needs (RESEARCH §B):
 *
 *   For each of the 30 DemandRecords (src/demands.ts), run a 3-turn round using
 *   AUTHORED archetype replies (a weak / a mid / a strong reply per demand, in
 *   Yapoleon's register), calling the REAL judge at the PRODUCTION shape
 *   (gemini-3.5-flash, flat responseMimeType/responseSchema, temperature 0.2,
 *   thinkingLevel 'low' — byte-equivalent to api/court-judge.js), then applying the
 *   CURRENT favorDelta curve + the day's axis-weights SERVER-SIDE via the real
 *   deriveFavorDelta (src/judge.ts). The model returns ONLY axisScores; the delta
 *   is NEVER model-emitted (the fairness backbone, JUDGE-03 / Pitfall 3).
 *
 * MEASURES (≥3 runs per (demand, archetype) — hosted Gemini is NOT bit-reproducible
 * at low temp, so we report the MEDIAN, not a point value, RESEARCH §B caveat):
 *   - the MEDIAN win-rate across the 30 demands (the 55–70% calibration gate),
 *   - per-archetype win-rates (must be learnable: strong > mid > weak),
 *   - a FIXED-MOLD off-axis probe: one rhetorical mold applied to ALL 30 days,
 *     asserting it LOSES on its off-axis days (the D-03 structural defense,
 *     validated not claimed).
 *
 * RUNNING IT (tsx is NOT installed; installing is checkpoint-gated):
 *   This module imports the real src/demands.ts → src/daily.ts via EXTENSIONLESS
 *   bundler-style imports, which Node's strict ESM resolver (used by
 *   `node --experimental-strip-types`) rejects. It is therefore driven through the
 *   EXISTING vitest toolchain, which resolves those imports natively. A thin
 *   throwaway runner spec imports `runCalibration` from here and awaits it. See
 *   the §"How this was run" note in CALIBRATION.md.
 *
 * Authoring/calibration tool ONLY — never imported at runtime, never shipped.
 *
 * SECRETS: GEMINI_API_KEY is read in-memory from .env.local / .env / the
 * environment and is NEVER printed. The harness emits NO key material.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AXES, clamp01, deriveFavorDelta, type Axis } from '../src/judge';
import { DEMANDS, type DemandRecord } from '../src/demands';
import { buildYapoleonPrompt } from '../src/prompts/yapoleon';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

// Production judge constants — kept byte-equivalent to api/court-judge.js so the
// simulator scores against the SAME judge players hit (do NOT modify court-judge.js).
const JUDGE_MODELS = ['gemini-3.5-flash', 'gemini-2.5-flash'];
const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    axisScores: {
      type: 'object',
      properties: {
        wit: { type: 'number' },
        specificity: { type: 'number' },
        audacity: { type: 'number' },
        economy: { type: 'number' },
        flattery: { type: 'number' },
      },
      required: ['wit', 'specificity', 'audacity', 'economy', 'flattery'],
    },
    dominantAxis: { type: 'string', enum: AXES },
    reaction: { type: 'string' },
  },
  required: ['axisScores', 'dominantAxis', 'reaction'],
};

// The scoring directive appended to the judging-voice contents — byte-equivalent
// to JUDGE_SCORING_DIRECTIVE in api/court-judge.js (so the prompt the model sees in
// the sim is the prompt it sees in production).
const JUDGE_SCORING_DIRECTIVE = [
  '',
  'In addition to your in-voice reaction, score the reply on each of the five axes',
  'from 0 to 1 (wit, specificity, audacity, economy, flattery) and name the single',
  'dominant axis. Put your one-line in-voice reaction in the "reaction" field. Return',
  'ONLY the JSON object matching the schema — the score numbers stay in the JSON,',
  'never in the reaction line.',
].join('\n');

// Round constants (locked, src/round.ts / RESEARCH §G): 3-turn cap, win at 100.
const MAX_TURNS = 3;
const WIN_FAVOR = 100;
const FLOOR_FAVOR = 0;

// ── Key resolution (in-memory; never printed) ──
function loadKey(): string | null {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  for (const name of ['.env.local', '.env']) {
    try {
      const m = readFileSync(join(REPO_ROOT, name), 'utf8').match(/^GEMINI_API_KEY=(.*)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

// ── The real judge call (direct Gemini, production shape) ──
type AxisScores = Record<Axis, number>;
interface JudgeCall {
  ok: boolean;
  axisScores?: AxisScores;
  reaction?: string;
  detail?: string;
}

async function callJudge(scene: string, reply: string, key: string): Promise<JudgeCall> {
  // Build the judging-voice prompt EXACTLY as api/court-judge.js does.
  const voice = buildYapoleonPrompt({ state: 'judging', scene, reply });
  const geminiBody = {
    contents: [{ parts: [{ text: voice.contents + '\n' + JUDGE_SCORING_DIRECTIVE }] }],
    system_instruction: { parts: [{ text: voice.systemInstruction }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: JUDGE_SCHEMA,
      temperature: voice.temperature, // 0.2 — the production scoring temp
      thinkingConfig: { thinkingLevel: 'low' },
    },
  };

  let lastDetail = '';
  for (const model of JUDGE_MODELS) {
    let r: Response;
    try {
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(geminiBody),
        },
      );
    } catch (e) {
      lastDetail = `network: ${(e as Error).message}`;
      continue;
    }
    if (!r.ok) {
      lastDetail = `${model} -> HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`;
      // 429 / 4xx: try the fallback model, then give up.
      continue;
    }
    const data: any = await r.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      lastDetail = `${model} -> unparseable JSON`;
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.axisScores) {
      lastDetail = `${model} -> missing axisScores`;
      continue;
    }
    // Clamp axis scores to [0,1] exactly like the production handler.
    const axisScores = {} as AxisScores;
    for (const ax of AXES) axisScores[ax] = clamp01(parsed.axisScores[ax]);
    return {
      ok: true,
      axisScores,
      reaction: typeof parsed.reaction === 'string' ? parsed.reaction : '',
    };
  }
  return { ok: false, detail: lastDetail };
}

// ── Archetype replies (the simulated players) ──
// For each demand: a WEAK (clichéd / off-axis / generic), a MID (decent but not
// sharp), and a STRONG reply (in-voice, hits the demand's emphasized axis). ~90
// short authored lines. The strong reply is engineered to score high on the day's
// dominant axis; the weak reply is generic flattery / hedging that the rubric
// must punish. This is the learnability substrate (strong > mid > weak).
type Archetype = 'weak' | 'mid' | 'strong';
const ARCHETYPE_REPLIES: Record<string, Record<Archetype, string[]>> = {
  // ── audacity-heavy ──
  'audacity-most-dangerous': {
    weak: ['Your Majesty, you are wonderful and everyone here adores you completely.'],
    mid: ['Honestly, sire, half your court would sell the other half for your chair, and you know it.'],
    strong: [
      'You surround yourself with mirrors and call it counsel. Everyone here flatters the version of you that never asks why.',
    ],
  },
  'audacity-correct-the-emperor': {
    weak: ['I would never correct you, sire, you are always right about everything.'],
    mid: ['Sire, the eastern tax records you cited — the figure was last spring’s, not this one’s.'],
    strong: [
      'You said no one outlasts you. The marble does. Your statue will hold this pose long after the man inside it has changed his mind about it.',
    ],
  },
  'audacity-demand-something': {
    weak: ['If it pleases you, sire, might I humbly ask for a small token of your favor?'],
    mid: ['Give me the dull seat at the far end of your table, sire. I do my best listening where no one performs.'],
    strong: [
      'I want your worst hour, sire — the one you tell as triumph. Hand it over and I’ll make it the only honest thing in this room.',
    ],
  },
  'audacity-unforgivable-opinion': {
    weak: ['I think you are simply the greatest emperor who has ever lived, truly.'],
    mid: ['Power suits you, sire, but the applause has dulled your ear; you laugh a beat late now.'],
    strong: [
      'Mercy is the one extravagance you cannot afford, because you suspect it would be the only thing they remembered you for.',
    ],
  },
  'audacity-refuse-him': {
    weak: ['Of course, sire, whatever you ask I will gladly do at once.'],
    mid: ['No, sire. You’d respect the yes less by tomorrow, and so would I.'],
    strong: [
      'No. You asked to watch me fold, and the only gift worth giving an emperor is the thing he cannot order. Keep the favor; I’ll keep the spine.',
    ],
  },
  'audacity-bet-against-him': {
    weak: ['I would never bet against you, sire, you would surely win any wager.'],
    mid: ['Wager you can’t go one full day, sire, without saying your own name. Loser tells the truth at dinner.'],
    strong: [
      'I bet you can’t hear a better line than your own tonight and admit it out loud. Stakes: if you can, you concede — to me, in front of them.',
    ],
  },

  // ── economy-heavy ──
  'economy-one-breath': {
    weak: [
      'Well, Your Majesty, I would just like to begin by saying what an enormous honor it is to stand before you today and address such a magnificent and powerful ruler.',
    ],
    mid: ['You rule the room before you speak. The speaking is just for us.'],
    strong: ['You command silence. I returned some.'],
  },
  'economy-five-words': {
    weak: ['You are the greatest and most magnificent emperor in all of history forever, sire.'],
    mid: ['Five words, sire: you already know I’m right.'],
    strong: ['Crown fits. Ego barely does.'],
  },
  'economy-no-throat-clearing': {
    weak: ['I am so sorry to bother you, and I apologize in advance, but I just wanted to perhaps mention something.'],
    mid: ['You waste no one’s time but everyone’s patience. Pick one.'],
    strong: ['You’re bored. I’m brief. We’re solved.'],
  },
  'economy-one-sentence-life': {
    weak: ['I have done many things in my life and I believe I am a fairly worthwhile and decent person overall, all things considered.'],
    mid: ['My worth is that I stop talking before you wish I would.'],
    strong: ['I’m the only sentence here you’d quote.'],
  },
  'economy-cut-it-shorter': {
    weak: ['I think that, on the whole, when one considers everything, you are really quite an impressive and admirable sort of ruler.'],
    mid: ['You. Listening. Already a rarer thing than the throne.'],
    strong: ['Less. There. Done.'],
  },
  'economy-the-toast': {
    weak: ['To our great and powerful and wonderful emperor, may he reign forever and ever in glory and splendor and majesty!'],
    mid: ['To the only man who toasts himself and means it.'],
    strong: ['To Yapoleon: shorter than his legend, sharper than his court.'],
  },

  // ── specificity-heavy ──
  'specificity-one-true-thing': {
    weak: ['You are wise and great and your reign is glorious in every possible way, sire.'],
    mid: ['You let people finish, sire — then quote them back better than they said it.'],
    strong: [
      'You pause a half-second before any decision you’ve already made, so the room thinks it watched you choose. That theater is the reign.',
    ],
  },
  'specificity-the-detail': {
    weak: ['This is a beautiful hall, sire, truly magnificent and grand in every way.'],
    mid: ['The west windows are taller than the east, sire — the morning gets the better light, and so do you.'],
    strong: [
      'The third floor-tile from your dais is worn pale — that’s where petitioners stand to be refused. You built a throne room with a flinching spot.',
    ],
  },
  'specificity-not-the-obvious': {
    weak: ['Your mind is brilliant, sire, the most brilliant mind there has ever been.'],
    mid: ['You’re not the fastest in the room, sire — you’re the one who waits for the fast one to be wrong.'],
    strong: [
      'Your cleverness isn’t the answer; it’s the question you ask second, after the obvious one has flushed every fool in the room into the open.',
    ],
  },
  'specificity-the-small-tell': {
    weak: ['You have many wonderful habits, sire, all of them admirable.'],
    mid: ['You tap your ring twice when you’ve decided, sire, and stop pretending to listen.'],
    strong: [
      'When a line truly lands, you don’t laugh — you go still and reread the speaker’s face, hunting the next one. You’re doing it now.',
    ],
  },
  'specificity-name-the-moment': {
    weak: ['History will remember your whole glorious reign, sire, every magnificent moment of it.'],
    mid: ['The morning you pardoned the cartographer, sire — history should keep that one over the battles.'],
    strong: [
      'The night the lamps failed mid-audience and you finished the sentence in the dark — no one moved. That’s the moment; the throne was just furniture by comparison.',
    ],
  },
  'specificity-the-flaw': {
    weak: ['You have no flaws at all, sire, you are completely perfect in every way.'],
    mid: ['You finish other people’s sentences a touch too soon, sire — sometimes the dull one was about to turn clever.'],
    strong: [
      'You correct the small error instantly and let the large one stand, because the small one is winnable in front of an audience and the large one isn’t.',
    ],
  },

  // ── flattery-calibration (naked grovel must LOSE) ──
  'flattery-praise-without-grovel': {
    weak: ['You are the most magnificent, glorious, perfect, dazzling emperor to ever grace this earth, sire!'],
    mid: ['You’re hard to praise, sire, because the obvious words bore you and you’ve heard the clever ones.'],
    strong: [
      'I won’t praise the crown; it didn’t earn the room. You did — by being the only one here who’d rather be argued with than adored.',
    ],
  },
  'flattery-compliment-with-teeth': {
    weak: ['You are simply perfect and wonderful and I admire you beyond all measure, truly.'],
    mid: ['You’re the cleverest man in the room, sire, which is a low bar you keep importing courtiers to maintain.'],
    strong: [
      'You’re brilliant, and insufferable about it, and the insufferable part is the proof — only a real wit is this expensive to be near.',
    ],
  },
  'flattery-earned-not-poured': {
    weak: ['I admire you endlessly, sire, with all my heart, more than words could ever say.'],
    mid: ['I admire that you read the contract no one expected you to read, sire, and priced it accordingly.'],
    strong: [
      'My admiration is one line long: you remembered a clerk’s name three years after firing him, and used it to hire him back cheaper. That’s earned.',
    ],
  },
  'flattery-the-honest-kind': {
    weak: ['You are the greatest, most wonderful, most admirable emperor in all of history, sire, honestly!'],
    mid: ['I’d say you’re sharp whether or not you were listening, sire — luckily for me, you always are.'],
    strong: [
      'Here’s what I’d say in the next room with your back turned: he’s the only one whose flattery he can’t buy, which is why ours never works.',
    ],
  },
  'flattery-without-the-word-great': {
    weak: ['You are great, sire, truly great, the greatest and most magnificent ruler of all!'],
    mid: ['You make the room arrive early, sire, and leave quoting you. Few empty chairs manage that.'],
    strong: [
      'Rooms reorganize around where you’re about to stand. No one taught them that. They learned it the way weather is learned.',
    ],
  },
  'flattery-the-backhand': {
    weak: ['You are wonderful, sire, and everyone else here is also wonderful, we are all so lucky!'],
    mid: ['Your court would drown in its own perfume, sire, if you didn’t open a window now and then.'],
    strong: [
      'These others flatter you in chorus because none can do it solo. You’re the only voice in your court worth listening to — which is its own quiet indictment of the hiring.',
    ],
  },

  // ── wit-heavy (statue golden-path lives here) ──
  'wit-statue-golden': {
    weak: ['The statue is beautiful, sire, a perfect and magnificent likeness of your greatness.'],
    mid: ['Carve underneath, sire: “the marble flinched first.”'],
    strong: [
      'Under it carve: “He held this pose so the rest of us could finally catch up.” The marble’s the only one in the room not exhausted by the effort.',
    ],
  },
  'wit-amuse-or-leave': {
    weak: ['I hope I can amuse you, sire, you are so very wonderful and entertaining yourself!'],
    mid: ['Boredom is just an emperor who’s run out of people to be right at, sire.'],
    strong: [
      'You’re not bored, sire — you’ve simply heard every joke twice and told the better half yourself. The cure isn’t amusement; it’s competition.',
    ],
  },
  'wit-finish-his-thought': {
    weak: ['Whatever you were thinking, sire, I am sure it was brilliant and perfect, as always.'],
    mid: ['…and that, sire, is why the wise man arrives late: so the room is already wrong when he speaks.'],
    strong: [
      '…which is why power is the only joke that gets funnier the fewer people are allowed to laugh at it. You stopped this thought there because the next line was about you.',
    ],
  },
  'wit-the-better-insult': {
    weak: ['The jester was bad, sire, not funny at all, unlike you who are very funny.'],
    mid: ['The jester died of a slow act, sire — the only thing he ever timed wrong.'],
    strong: [
      'The jester’s tragedy, sire: he spent a career making people laugh and an emperor making one man wince — and only learned, too late, which the job paid for.',
    ],
  },
  'wit-pun-worth-keeping': {
    weak: ['I am not very good at puns, sire, but you are wonderful and very clever indeed!'],
    mid: ['Reign or shine, sire, you insist on the forecast being about you.'],
    strong: [
      'They say absolute power corrupts absolutely, sire — but yours merely abbreviates: you’ve no time to be partly anything.',
    ],
  },
  'wit-turn-the-weather': {
    weak: ['It is raining, sire, but you are sunshine itself, the brightest in the land!'],
    mid: ['Even the rain knocks before entering your hall, sire — it just forgot today.'],
    strong: [
      'The rain’s the one thing in your realm that arrives uninvited and stays as long as it likes. No wonder you watch it like a rival, sire.',
    ],
  },
};

// ── The fixed-mold probe (D-03 structural defense) ──
// ONE rhetorical mold applied to ALL 30 days: a generic, well-formed FLATTERY mold.
// It is a competent reply, but it is a single shape — flattery + a vague grand
// gesture. It should WIN on flattery-friendly days and LOSE on its off-axis days
// (audacity / economy / specificity / wit). If the fixed mold wins everywhere, the
// daily weight-shift is cosmetic. If it loses off-axis, the defense is real.
const FIXED_MOLD =
  'Your Majesty, no words could capture your magnificence, yet I will try: you are the brightest light this court has ever known, and to stand before you is the honor of my life.';

// ── Statistics helpers ──
function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
function dominantAxisOf(d: DemandRecord): Axis {
  let top: Axis = AXES[0];
  for (const ax of AXES) if (d.axisWeights[ax] > d.axisWeights[top]) top = ax;
  return top;
}

// ── One simulated 3-turn round ──
// Plays the SAME archetype reply each turn (a fixed-strength player), applying the
// real server-side delta after each judge call. A round WINS if favor reaches 100
// within MAX_TURNS turns. Returns { win, favor, turns, reactions, ok }.
interface RoundResult {
  win: boolean;
  favor: number;
  turns: number;
  ok: boolean;
  detail?: string;
  turnScores: Record<Axis, number>[]; // raw per-turn axisScores (for offline curve fitting)
}
async function simulateRound(
  d: DemandRecord,
  reply: string,
  key: string,
): Promise<RoundResult> {
  let favor = 0;
  let turns = 0;
  let win = false;
  const turnScores: Record<Axis, number>[] = [];
  for (let t = 0; t < MAX_TURNS; t++) {
    const judged = await callJudge(d.scene, reply, key);
    if (!judged.ok || !judged.axisScores) {
      return { win, favor, turns, ok: false, detail: judged.detail, turnScores };
    }
    turnScores.push(judged.axisScores);
    // SERVER-SIDE delta — the model NEVER returns it (JUDGE-03 / Pitfall 3).
    const delta = deriveFavorDelta(judged.axisScores, d.axisWeights);
    favor = Math.max(FLOOR_FAVOR, Math.min(WIN_FAVOR, favor + delta));
    turns = t + 1;
    // Latch the win but keep playing all MAX_TURNS so every round captures full taste
    // ("won within MAX_TURNS" is the metric; extra turns never unset it).
    if (favor >= WIN_FAVOR) win = true;
  }
  return { win, favor, turns, ok: true, turnScores };
}

// ── The calibration run ──
export interface CalibrationOptions {
  runsPerCell?: number; // ≥3 runs per (demand, archetype); RESEARCH §B floor
  key?: string | null;
  log?: (line: string) => void;
  maxDemands?: number;   // cap: run only the first N demands (smoke-test)
  concurrency?: number;  // bounded parallel demands (default 6 → peak 6 concurrent judge calls)
}
export interface DemandOutcome {
  id: string;
  bucket: Axis;
  perArchetype: Record<Archetype, { winRate: number; runs: number; medFavor: number }>;
  // demand win-rate = the MID archetype's win-rate (the representative player) for
  // the headline median; per-archetype rates are reported separately for learnability.
  demandWinRate: number;
  fixedMold: { winRate: number; runs: number; medFavor: number; offAxis: boolean };
}
export interface DemandCapture {
  id: string;
  axisWeights: Record<Axis, number>;
  // archetype name or 'mold' -> runs -> turns -> raw axisScores (offline curve fitting)
  cells: Record<string, Record<Axis, number>[][]>;
}
export interface CalibrationReport {
  ranAt: string;
  runsPerCell: number;
  totalJudgeCalls: number;
  perDemand: DemandOutcome[];
  rawCapture?: DemandCapture[];
  medianWinRateMid: number; // headline: median over the 30 demands (mid archetype)
  medianWinRateAll: number; // median over the 30 demands averaging the 3 archetypes
  archetypeWinRate: Record<Archetype, number>; // mean over all demands
  fixedMold: {
    offAxisWinRate: number; // win-rate on off-axis days (should be LOW)
    onAxisWinRate: number; // win-rate on flattery-friendly days (allowed higher)
    losesOffAxis: boolean; // the structural-defense assertion
  };
  learnable: boolean; // strong > mid > weak
  errors: string[];
}

const ARCHS: Archetype[] = ['weak', 'mid', 'strong'];

export async function runCalibration(opts: CalibrationOptions = {}): Promise<CalibrationReport> {
  const runsPerCell = Math.max(3, opts.runsPerCell ?? 3);
  const log = opts.log ?? ((l: string) => console.log(l));
  const key = opts.key ?? loadKey();
  if (!key) throw new Error('Missing GEMINI_API_KEY (looked at env, .env.local, .env)');
  const demands = opts.maxDemands ? DEMANDS.slice(0, opts.maxDemands) : DEMANDS;
  const concurrency = Math.max(1, opts.concurrency ?? 6);

  const errors: string[] = [];
  let totalJudgeCalls = 0;
  const perDemand: DemandOutcome[] = [];

  log(`\n${'='.repeat(72)}`);
  log(`YAPOLEON FAIR FIGHT CALIBRATION — win-rate simulator`);
  log(`model: ${JUDGE_MODELS[0]} (fallback ${JUDGE_MODELS[1]}), temp 0.2, thinkingLevel low`);
  log(`demands: ${demands.length} · archetypes: weak/mid/strong · runs/cell: ${runsPerCell} · concurrency: ${concurrency}`);
  log(`${'='.repeat(72)}\n`);

  const processDemand = async (
    d: (typeof DEMANDS)[number],
  ): Promise<{ outcome: DemandOutcome; calls: number; errs: string[]; capture: DemandCapture }> => {
    const errs: string[] = [];
    let calls = 0;
    const bucket = dominantAxisOf(d);
    const perArchetype = {} as DemandOutcome['perArchetype'];
    const capture: DemandCapture = { id: d.id, axisWeights: d.axisWeights, cells: {} };

    for (const arch of ARCHS) {
      const replies = ARCHETYPE_REPLIES[d.id]?.[arch];
      if (!replies || replies.length === 0) {
        errs.push(`no ${arch} reply authored for ${d.id}`);
        perArchetype[arch] = { winRate: NaN, runs: 0, medFavor: NaN };
        continue;
      }
      const wins: number[] = [];
      const favors: number[] = [];
      for (let r = 0; r < runsPerCell; r++) {
        const reply = replies[r % replies.length];
        // eslint-disable-next-line no-await-in-loop
        const res = await simulateRound(d, reply, key);
        calls += res.turns; // count actual judge calls made
        if (!res.ok) {
          errs.push(`${d.id}/${arch} run ${r + 1}: ${res.detail ?? 'judge error'}`);
          continue;
        }
        wins.push(res.win ? 1 : 0);
        favors.push(res.favor);
        (capture.cells[arch] ??= []).push(res.turnScores);
      }
      perArchetype[arch] = {
        winRate: wins.length ? mean(wins) : NaN,
        runs: wins.length,
        medFavor: median(favors),
      };
    }

    // Fixed-mold probe for this demand.
    const moldWins: number[] = [];
    const moldFavors: number[] = [];
    for (let r = 0; r < runsPerCell; r++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await simulateRound(d, FIXED_MOLD, key);
      calls += res.turns;
      if (!res.ok) {
        errs.push(`${d.id}/fixed-mold run ${r + 1}: ${res.detail ?? 'judge error'}`);
        continue;
      }
      moldWins.push(res.win ? 1 : 0);
      moldFavors.push(res.favor);
      (capture.cells.mold ??= []).push(res.turnScores);
    }
    const offAxis = bucket !== 'flattery';
    const fixedMold = {
      winRate: moldWins.length ? mean(moldWins) : NaN,
      runs: moldWins.length,
      medFavor: median(moldFavors),
      offAxis,
    };

    const demandWinRate = perArchetype.mid.winRate;
    const outcome: DemandOutcome = { id: d.id, bucket, perArchetype, demandWinRate, fixedMold };

    log(
      `${d.id.padEnd(34)} [${bucket}] ` +
        `weak ${fmtPct(perArchetype.weak.winRate)} · ` +
        `mid ${fmtPct(perArchetype.mid.winRate)} · ` +
        `strong ${fmtPct(perArchetype.strong.winRate)} | ` +
        `mold ${fmtPct(fixedMold.winRate)}${offAxis ? ' (off-axis)' : ' (on-axis)'}`,
    );
    return { outcome, calls, errs, capture };
  };

  // Bounded-concurrency pool over demands (peak ≈ `concurrency` concurrent judge calls,
  // since each demand's own turns/runs are sequential inside processDemand).
  const results: {
    outcome: DemandOutcome;
    calls: number;
    errs: string[];
    capture: DemandCapture;
  }[] = new Array(demands.length);
  let nextIdx = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, demands.length) }, async () => {
      for (let i = nextIdx++; i < demands.length; i = nextIdx++) {
        results[i] = await processDemand(demands[i]);
      }
    }),
  );
  const rawCapture: DemandCapture[] = [];
  for (const res of results) {
    perDemand.push(res.outcome);
    totalJudgeCalls += res.calls;
    errors.push(...res.errs);
    rawCapture.push(res.capture);
  }

  // ── Aggregate ──
  const midRates = perDemand.map((p) => p.demandWinRate).filter((x) => !Number.isNaN(x));
  const allRates = perDemand
    .map((p) => mean(ARCHS.map((a) => p.perArchetype[a].winRate).filter((x) => !Number.isNaN(x))))
    .filter((x) => !Number.isNaN(x));
  const archetypeWinRate = {} as Record<Archetype, number>;
  for (const a of ARCHS) {
    archetypeWinRate[a] = mean(
      perDemand.map((p) => p.perArchetype[a].winRate).filter((x) => !Number.isNaN(x)),
    );
  }

  const offAxisDemands = perDemand.filter((p) => p.fixedMold.offAxis);
  const onAxisDemands = perDemand.filter((p) => !p.fixedMold.offAxis);
  const offAxisWinRate = mean(offAxisDemands.map((p) => p.fixedMold.winRate).filter((x) => !Number.isNaN(x)));
  const onAxisWinRate = mean(onAxisDemands.map((p) => p.fixedMold.winRate).filter((x) => !Number.isNaN(x)));

  const report: CalibrationReport = {
    ranAt: new Date().toISOString(),
    runsPerCell,
    totalJudgeCalls,
    perDemand,
    rawCapture,
    medianWinRateMid: median(midRates),
    medianWinRateAll: median(allRates),
    archetypeWinRate,
    fixedMold: {
      offAxisWinRate,
      onAxisWinRate,
      // Structural defense: the single flattery mold must lose on average off-axis
      // (sub-50% win-rate on the audacity/economy/specificity/wit days).
      losesOffAxis: offAxisWinRate < 0.5,
    },
    learnable: archetypeWinRate.strong > archetypeWinRate.mid && archetypeWinRate.mid > archetypeWinRate.weak,
    errors,
  };

  log(`\n${'-'.repeat(72)}`);
  log(`MEDIAN win-rate (mid archetype, the headline gate): ${fmtPct(report.medianWinRateMid)}`);
  log(`MEDIAN win-rate (avg of 3 archetypes): ${fmtPct(report.medianWinRateAll)}`);
  log(
    `per-archetype mean: weak ${fmtPct(archetypeWinRate.weak)} · ` +
      `mid ${fmtPct(archetypeWinRate.mid)} · strong ${fmtPct(archetypeWinRate.strong)} ` +
      `(learnable: ${report.learnable ? 'YES strong>mid>weak' : 'NO'})`,
  );
  log(
    `fixed-mold: off-axis ${fmtPct(offAxisWinRate)} vs on-axis(flattery) ${fmtPct(onAxisWinRate)} ` +
      `(loses-off-axis: ${report.fixedMold.losesOffAxis ? 'YES' : 'NO'})`,
  );
  log(`total live judge calls: ${totalJudgeCalls}`);
  if (errors.length) log(`errors/degradations: ${errors.length} (see report.errors)`);
  log(`${'-'.repeat(72)}\n`);

  return report;
}

function fmtPct(x: number): string {
  return Number.isNaN(x) ? ' n/a' : `${Math.round(x * 100)}%`;
}

// ── CLI entry (best-effort; the supported path is the vitest runner — see header) ──
// Guarded so importing this module (vitest runner) does NOT auto-run main().
const INVOKED_DIRECTLY =
  typeof process !== 'undefined' && process.argv?.[1]?.includes('yapoleon-calibrate');
if (INVOKED_DIRECTLY) {
  runCalibration().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
