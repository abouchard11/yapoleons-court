// Calibration sweep for the JUDGE-05 own-history near-duplicate threshold (Plan 03-03).
// Runs the in-repo trigramJaccardSimilarity over a LABELED fixture of reply pairs and
// reports, per candidate threshold, the true-positive rate (caught repeats) and the
// false-positive rate (distinct-but-clever answers wrongly flagged). A false positive is
// the fairness risk (a wrong "I've heard that one"), so the FP rate drives the choice.
//
// Precedent: 01-06 (win-rate) + 02-02 (anti-gaming) self-contained their calibration.
// Run: node scripts/calibrate-anti-repeat.mjs

import { trigramJaccardSimilarity } from '../api/_yapoleon-observability.js';

// Each pair answers the SAME demand ("Justify the statue I have not yet commissioned of
// myself"). REPEAT = the player resubmitting the same idea (exact / reworded / reordered).
// DISTINCT = a genuinely different clever answer (MUST NOT flag).
const REPEATS = [
  // exact resubmission
  ['A statue would only diminish you, Sire — marble cannot smirk.',
   'A statue would only diminish you, Sire — marble cannot smirk.'],
  // trivial reword
  ['Your genius needs no monument; stone is too dull to hold it.',
   'Your brilliance needs no monument — stone is far too dull to contain it.'],
  // reordered clauses
  ['Marble cannot smirk, Sire; a statue would only diminish you.',
   'A statue would only diminish you, Sire — marble cannot smirk.'],
  // same joke, light paraphrase
  ['Even the sun is embarrassed to share the sky with you.',
   'Even the sun would be embarrassed to stand in the same sky as you.'],
  // near-verbatim with filler words
  ['You are, quite simply, the greatest mind the court has ever known.',
   'You are simply the greatest mind this court has ever known.'],
  // padded resubmission
  ['Spare the marble; spend it on a mirror — you would get far more use of it.',
   'Honestly, spare the marble. Spend it on a mirror; you would get more use.'],
];

const DISTINCT = [
  ['A statue would only diminish you, Sire — marble cannot smirk.',
   'Commission it. Future emperors deserve something to feel inadequate beside.'],
  ['Even the sun is embarrassed to share your sky.',
   'Your enemies sleep soundly; it is the only mercy you have ever granted them.'],
  ['Marble cannot hold your wit, Sire.',
   'Build it, and the pigeons will finally have a perch worthy of their opinions.'],
  ['Your genius needs no monument.',
   'I refuse — a likeness would only teach the people to expect two of you.'],
  ['You are the greatest mind the court has known.',
   'Spare the marble. A statue cannot duck, and your subjects have poor aim.'],
  ['Stone is too dull to contain you.',
   'Erect it facing the throne, so you may at last be judged by your equal.'],
  ['A statue would diminish you.',
   'The realm is already your monument; anything smaller would be an insult.'],
  // distinct but both flattery-shaped (the hardest false-positive case)
  ['No monument could flatter a man the gods already over-favored.',
   'Your reflection has done more honest worship than any sculptor could.'],
];

const THRESHOLDS = [0.5, 0.55, 0.6, 0.65, 0.7];

const repeatSims = REPEATS.map(([a, b]) => trigramJaccardSimilarity(a, b));
const distinctSims = DISTINCT.map(([a, b]) => trigramJaccardSimilarity(a, b));

console.log('\n=== Per-pair similarity ===');
console.log('REPEATS (should flag):');
REPEATS.forEach(([a], i) => console.log(`  ${repeatSims[i].toFixed(3)}  "${a.slice(0, 48)}..."`));
console.log('DISTINCT (should NOT flag):');
DISTINCT.forEach(([a], i) => console.log(`  ${distinctSims[i].toFixed(3)}  "${a.slice(0, 48)}..."`));

console.log('\n=== Threshold sweep (TP = caught repeats, FP = wrongly-flagged distinct) ===');
console.log('thresh | TP/total  TPR  | FP/total  FPR  | verdict');
for (const t of THRESHOLDS) {
  const tp = repeatSims.filter((s) => s >= t).length;
  const fp = distinctSims.filter((s) => s >= t).length;
  const tpr = (tp / REPEATS.length * 100).toFixed(0);
  const fpr = (fp / DISTINCT.length * 100).toFixed(0);
  const verdict = fp === 0 ? (tp >= REPEATS.length - 1 ? 'clean + sensitive' : 'clean, misses soft repeats') : 'FALSE POSITIVES';
  console.log(`  ${t.toFixed(2)} |  ${tp}/${REPEATS.length}    ${tpr.padStart(3)}%  |  ${fp}/${DISTINCT.length}    ${fpr.padStart(3)}%  | ${verdict}`);
}
console.log('');
