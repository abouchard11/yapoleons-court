/**
 * yapoleon-lab.ts — the Yapoleon Demand Lab (re-pointed for Yapoleon's Court).
 *
 * FORKED from yapword's scripts/yapoleon-lab.ts (the Joke Lab that rendered the
 * REAL in-game lines for review). RE-POINTED (Plan 01-04, D-02 / CONT-01): this
 * game has no Wordle jokes — the thing the author drafts and the author voice-reviews is
 * the 30-demand calibration bank. So the lab now renders the authored demand
 * SCENES — Yapoleon's in-voice framing of each day's demand — into a clean
 * markdown REVIEW SHEET (one row per demand: id, scene, proposed axisWeights,
 * intended D-03 bucket). That sheet is exactly what the author skims in Task 3 to
 * mark the demands "approved" (or list which to revise).
 *
 * Authoring/review tool ONLY — never imported at runtime, never shipped.
 *
 * ── The Gemini spend-cap reality (2026-06) ──
 * The only GEMINI_API_KEY (yapword's) has hit its MONTHLY SPEND CAP — every live
 * call returns 429 RESOURCE_EXHAUSTED. The demand SCENES were therefore authored
 * directly in Yapoleon's voice (in src/demands.ts) rather than cron-generated, so
 * this lab's PRIMARY job is to render the authored bank into a reviewable sheet
 * with NO network call required. The default mode (no `--live`) reads the
 * authored DEMANDS and prints the review sheet offline. The optional `--live`
 * mode (for after the cap resets) re-renders each scene through the REAL voice
 * builder (buildYapoleonPrompt 'judging' state) so you can compare the authored
 * scene against a fresh live draft — but a 429 / missing key degrades back to the
 * authored scene + a [live-render unavailable] note. The review sheet ALWAYS
 * prints; the spend cap can never block producing the artifact.
 *
 * Usage:
 *   npx tsx scripts/yapoleon-lab.ts                 # offline: render authored bank → review sheet
 *   npx tsx scripts/yapoleon-lab.ts --live [--n 1]  # also draft a fresh live scene per demand (needs key + budget)
 *   npx tsx scripts/yapoleon-lab.ts --bucket audacity   # filter to one D-03 bucket
 *
 * Key resolution (only when --live): process.env.GEMINI_API_KEY, else
 * YAPOLEON_ENV_PATH, else <repo>/.env. The key is read in-memory and NEVER printed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AXES, type Axis } from '../src/judge';
import { DEMANDS, type DemandRecord } from '../src/demands';
import { buildYapoleonPrompt } from '../src/prompts/yapoleon';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const MODELS = ['gemini-3.5-flash', 'gemini-2.5-flash'];
const NON_RETRYABLE = new Set([400, 401, 403, 404, 413, 429]);

// ── D-03 bucket classifier ──
// A demand's intended bucket is whichever axis carries its dominant weight. The
// thresholds mirror the demands.test.ts coverage assertions so the sheet labels
// each row exactly as the structural-defense test reads it.
const BUCKETS: { axis: Axis; label: string; threshold: number }[] = [
  { axis: 'audacity', label: 'audacity-heavy', threshold: 0.35 },
  { axis: 'economy', label: 'economy-heavy', threshold: 0.35 },
  { axis: 'specificity', label: 'specificity-heavy', threshold: 0.35 },
  { axis: 'flattery', label: 'flattery-calibration', threshold: 0.3 },
  { axis: 'wit', label: 'wit-heavy', threshold: 0.35 },
];

function bucketOf(d: DemandRecord): string {
  // Dominant axis = the max-weighted one; report it with its weight.
  let top: Axis = AXES[0];
  for (const ax of AXES) if (d.axisWeights[ax] > d.axisWeights[top]) top = ax;
  const b = BUCKETS.find((x) => x.axis === top);
  return b ? b.label : `${top}-heavy`;
}

function weightsLine(d: DemandRecord): string {
  return AXES.map((ax) => `${ax} ${d.axisWeights[ax].toFixed(2)}`).join(' · ');
}

function sumOf(d: DemandRecord): number {
  return AXES.reduce((s, ax) => s + d.axisWeights[ax], 0);
}

// ── Optional live render (degrades on 429 / missing key) ──
function loadKey(): string | null {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const envPath = process.env.YAPOLEON_ENV_PATH || join(REPO_ROOT, '.env');
  try {
    const m = readFileSync(envPath, 'utf8').match(/^GEMINI_API_KEY=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    /* no .env — offline only */
  }
  return null;
}

async function liveScene(d: DemandRecord, key: string): Promise<string> {
  // Re-render the demand's framing through the REAL voice builder so a live draft
  // can be compared against the authored scene. Uses the 'judging' state's
  // system_instruction (the canonical baseline) with a scene-drafting contents.
  const { systemInstruction } = buildYapoleonPrompt({ state: 'judging', scene: d.scene });
  const contents =
    `Draft, in one or two sentences and fully in your own voice, the FRAMING you would use ` +
    `to issue this daily demand to your court (this is the "scene" the courtier reads before replying). ` +
    `The demand, in plain terms, is: ${d.scene}. Stay in the Wilde/Twain register; the joke is your own ego; ` +
    `specific or silent; no costume vocabulary; no emojis or quotes.`;
  const body = {
    contents: [{ parts: [{ text: contents }] }],
    system_instruction: { parts: [{ text: systemInstruction }] },
    generationConfig: { temperature: 0.9, topP: 0.95 },
  };
  let lastErr = '';
  for (const model of MODELS) {
    let r: Response;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = `network: ${(e as Error).message}`;
      continue;
    }
    if (r.ok) {
      const dj: any = await r.json();
      return (dj?.candidates?.[0]?.content?.parts?.[0]?.text ?? '(empty)').trim();
    }
    lastErr = `${model} -> HTTP ${r.status}: ${(await r.text()).slice(0, 100)}`;
    if (NON_RETRYABLE.has(r.status)) break;
  }
  return `[live-render unavailable: ${lastErr}]`;
}

// ── CLI ──
const argv = process.argv.slice(2);
let live = false;
let N = 1;
let bucketFilter: string | null = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--live') live = true;
  else if (argv[i] === '--n') N = Math.max(1, parseInt(argv[++i], 10));
  else if (argv[i] === '--bucket') bucketFilter = argv[++i]?.trim() ?? null;
}

async function main() {
  const rows = bucketFilter
    ? DEMANDS.filter((d) => bucketOf(d).startsWith(bucketFilter!))
    : DEMANDS;

  // Bucket distribution summary (D-03 structural-defense at-a-glance).
  const dist = new Map<string, number>();
  for (const d of DEMANDS) dist.set(bucketOf(d), (dist.get(bucketOf(d)) ?? 0) + 1);

  console.log(`\n# Yapoleon Demand Lab — review sheet (${rows.length} demand${rows.length === 1 ? '' : 's'})\n`);
  console.log(`> ${DEMANDS.length} authored demands · drafted in-voice (D-02) · voice-review once before shippable (CONT-01).`);
  console.log(`> Live render: ${live ? 'ON (degrades to authored scene on 429/no-key)' : 'OFF (authored bank, offline — Gemini spend-capped 2026-06)'}\n`);
  console.log('## D-03 bucket distribution\n');
  for (const [b, n] of [...dist.entries()].sort()) console.log(`- **${b}**: ${n}`);
  console.log('');

  const key = live ? loadKey() : null;
  if (live && !key) console.log('> (no GEMINI_API_KEY found — live render falls back to authored scenes)\n');

  for (const d of rows) {
    const sum = sumOf(d);
    const sumFlag = Math.abs(sum - 1) <= 0.001 ? '✓' : `⚠ ${sum.toFixed(3)}`;
    console.log(`\n### ${d.id} — _${bucketOf(d)}_`);
    console.log(`- **scene:** ${d.scene}`);
    console.log(`- **axisWeights:** ${weightsLine(d)}  (sum ${sumFlag})`);
    console.log(`- **rubric:** ${d.rubricVersion} · **tier:** ${d.tier}`);
    if (live && key) {
      for (let i = 0; i < N; i++) {
        // eslint-disable-next-line no-await-in-loop
        const drafted = await liveScene(d, key);
        console.log(`- _live draft ${i + 1}:_ ${drafted}`);
      }
    }
  }
  console.log('\n---\n_Mark each 👍/👎. Reply "demands approved" or list ids/weights to revise._\n');
}

void main();
