// Shared sanitization utility for stripping HTML/script from text before Supabase insert.
// Pure regex — no npm dependencies. Gemini output is plain text (not HTML),
// so this is a safety net, not a full HTML parser.
//
// SAFE-02 (Plan 04-02) adds a SIBLING export — `detectRedLines` — a deterministic
// red-lines-only input matcher (obscenity, zero model calls) that the judge
// serverless function calls BEFORE the single model call. It shares this module
// because it is the natural "clean the untrusted reply" seam, but it is a SEPARATE
// concern from `sanitizeText` and does NOT touch it: `sanitizeText` below is
// byte-unchanged.

/**
 * Sanitize text: strip HTML tags, decode common entities, collapse whitespace, truncate.
 * @param {*} text - Input text (falsy values return empty string)
 * @param {number} [maxLen=500] - Maximum output length
 * @returns {string} Sanitized text
 */
export function sanitizeText(text, maxLen = 500) {
  if (!text) return '';
  let s = String(text);

  // 1. Decode common HTML entities FIRST (so encoded tags become real tags for step 2)
  s = s.replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // 2. Strip script/style tags AND their content, then strip remaining HTML tags
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<[^>]*>/g, '');

  // 3. Collapse runs of spaces/tabs (preserve single newlines)
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');

  // 4. Trim leading/trailing whitespace
  s = s.trim();

  // 5. Truncate to maxLen
  if (s.length > maxLen) s = s.slice(0, maxLen);

  return s;
}

// ============================================================================
// SAFE-02 — deterministic RED-LINES input pre-filter (D-04/D-05/D-06/D-07).
//
// Engine: `obscenity` (already a dependency, installed by Plan 04-01 for the
// SAFE-01 OUTPUT scanner — this reuses the same DataSet/RegExpMatcher API). Its
// transformer pipeline normalizes leetspeak / unicode confusables-homoglyphs /
// collapsed-duplicates BEFORE matching, so an obfuscated slur (n1gg3r, homoglyph
// forms) cannot slip the scan. `RegExpMatcher` is non-backtracking (no ReDoS),
// and the reply is length-bounded (MAX_REPLY 500) upstream before this runs.
//
// SCOPE IS DELIBERATELY NARROW (D-05): this flags ONLY genuine red lines —
//   (a) slurs / hate (protected-characteristic slurs),
//   (b) a credible threat / self-harm directive,
//   (c) sexual content involving minors.
// General profanity and rudeness in player INPUT PASS: roasting the jester IS the
// game, and the all-ages bound lives on Yapoleon's OUTPUT (SAFE-01, Plan 04-01),
// NOT on neutering the input. Bias is precision/forgiving (D-06): a false positive
// costs a legitimate player a turn, so the keep-list is tight.
//
// D-07 (no-PII / COPPA-safe): the return value carries the flag + a coarse
// CATEGORY only — the matched text is NEVER returned or logged. The caller logs
// { flagged, category }; the offending reply is never persisted.
//
// HARD INVARIANT: this module never imports the judge or the favor-delta
// derivation and is never a scoring input. The moderation flag short-circuits
// BEFORE the model loop and is never passed into the favor math (verified by the
// judge-function grep AC).
// ============================================================================

import {
  DataSet,
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
  pattern,
} from 'obscenity';

// The category labels attached to a flagged match (D-07 taxonomy). Coarse by
// design — enough to triage the flag, never enough to reconstruct the input.
const CATEGORY = {
  SLUR_HATE: 'slur_hate',
  THREAT: 'threat',
  SEXUAL_MINOR: 'sexual_minor',
};

// ── (a) The slur/hate KEEP-LIST drawn from the obscenity English preset ──
// The preset carries 69 phrases spanning general profanity, adult sexual/anatomical
// vocabulary, AND protected-characteristic slurs. D-05 wants ONLY the last group,
// so we KEEP this explicit slur set and DROP everything else. (The plan frames this
// as a GENERAL_PROFANITY drop-set; a keep-list is the same predicate inverted and
// is the safer formulation for a red-lines-ONLY filter — an unrecognized future
// preset word defaults to DROP, i.e. "let cutting input through", the forgiving
// D-06 direction. Each kept word is a slur targeting a protected characteristic:
// race/ethnicity, sexual orientation, or disability.)
const SLUR_KEEP = new Set([
  // racial / ethnic / nationality slurs
  'abeed', 'abo', 'africoon', 'arabush', 'boonga', 'chingchong', 'chink',
  'kike', 'negro', 'nigger',
  // sexual-orientation / gender-identity slurs
  'dyke', 'fag', 'tranny',
  // disability slurs
  'retard', 'spastic',
]);
// Every KEPT preset phrase maps to the slur/hate category (its metadata carries
// only `originalWord`, so we resolve the category from this set membership).
const SLUR_ORIGINAL_WORDS = SLUR_KEEP;

// ── Build the narrow red-lines DataSet ──
// Metadata type carries BOTH the preset's `originalWord` (for the kept slurs) and
// an explicit `category` (for the custom threat / sexual-minor phrases we add).
const redLinesDataset = new DataSet()
  .addAll(englishDataset)
  // DROP every preset phrase that is NOT in the slur keep-list (general profanity
  // + adult sexual/anatomical vocabulary are not red lines — they pass).
  .removePhrasesIf((phrase) => !SLUR_KEEP.has(phrase.metadata?.originalWord ?? ''));

// ── (b) Credible-threat / self-harm red-line patterns (not in the preset) ──
// Precision-biased: explicit "I will <harm> you" / "kill yourself" constructions,
// not merely the word "kill" (so "you killed that line" or "dying of boredom" pass).
redLinesDataset.addPhrase((p) =>
  p
    .setMetadata({ category: CATEGORY.THREAT })
    .addPattern(pattern`kill yourself`)
    .addPattern(pattern`kill your self`)
    .addPattern(pattern`i will kill you`)
    .addPattern(pattern`im going to kill you`)
    .addPattern(pattern`i am going to kill you`)
    .addPattern(pattern`i will murder you`)
    .addPattern(pattern`i will hunt you down`)
    .addPattern(pattern`i will find you and`)
    .addPattern(pattern`i hope you die`)
    .addPattern(pattern`you should die`)
    .addPattern(pattern`go die`),
);

// ── (c) Sexual-content-involving-minors red-line patterns (not in the preset) ──
// The narrowest possible constructions that pair a sexual act with a minor
// referent. Kept tight to avoid false positives on non-sexual mentions of
// children (e.g. "childish", "act like a child" pass — no sexual token).
redLinesDataset.addPhrase((p) =>
  p
    .setMetadata({ category: CATEGORY.SEXUAL_MINOR })
    .addPattern(pattern`sex with a child`)
    .addPattern(pattern`sex with a kid`)
    .addPattern(pattern`sex with a minor`)
    .addPattern(pattern`sex with children`)
    .addPattern(pattern`sex with kids`)
    .addPattern(pattern`child porn`)
    .addPattern(pattern`child pornography`)
    .addPattern(pattern`molest a child`)
    .addPattern(pattern`rape a child`)
    .addPattern(pattern`underage sex`),
);

// ── Scunthorpe guards (D-06 precision) ──
// The kept slurs are whole-word protected-characteristic slurs, and obscenity's
// word-boundary matching + transformer pipeline already lets innocent substrings
// through (verified: "assessment"/"class"/"constitution" do not trip the matcher).
// Whitelisted terms belong to the PHRASE whose pattern would otherwise mis-fire;
// none of the kept red-line phrases false-fire on a common innocent word, so no
// blanket whitelist is added here (adding one for a slur would create a bypass).

// Non-backtracking matcher (ReDoS-safe) with the recommended transformer pipeline.
const redLinesMatcher = new RegExpMatcher({
  ...redLinesDataset.build(),
  // leet + unicode confusables/homoglyphs + collapse-duplicates + ascii-lowercase.
  ...englishRecommendedTransformers,
});

// ── Zero-width / format / combining normalization (SAFE-02 bypass fix) ──
// obscenity's englishRecommendedTransformers normalize leet + confusables +
// collapsed-duplicates, but they do NOT strip ZERO-WIDTH / format / combining
// characters. So a slur split by a zero-width space (`n​ig​ger`) or
// carrying combining marks slips the scan untouched. We NFKC-normalize and strip
// those code points BEFORE matching so the obfuscation collapses to the base
// letters the matcher already catches. Linear, single-pass regex — ReDoS-safe
// (character-class replacement, no alternation/backtracking). We match on the
// normalized copy but STILL return category-only, never the text (D-07).
//
// Stripped set:
//   ​–‍  zero-width space / non-joiner / joiner
//   ﻿         zero-width no-break space (BOM)
//   ⁠         word joiner
//   ­         soft hyphen
//   \p{Cf}         all Unicode "format" characters (superset incl. bidi controls)
//   \p{Mn}         all non-spacing combining marks
const ZERO_WIDTH_AND_MARKS = /[​-‍﻿⁠­\p{Cf}\p{Mn}]/gu;

function normalizeForRedLines(text) {
  // NFKC folds compatibility forms (full-width, ligatures) to their base; the
  // strip then removes invisible/format/combining code points used to split words.
  return text.normalize('NFKC').replace(ZERO_WIDTH_AND_MARKS, '');
}

// Resolve the category for a match: custom phrases carry `category` directly; the
// kept preset slurs carry only `originalWord`, so those map to the slur category.
function categoryForMatch(phraseMetadata) {
  if (phraseMetadata?.category) return phraseMetadata.category;
  if (phraseMetadata?.originalWord && SLUR_ORIGINAL_WORDS.has(phraseMetadata.originalWord)) {
    return CATEGORY.SLUR_HATE;
  }
  return 'red_line';
}

/**
 * SAFE-02 deterministic red-lines pre-filter. Returns the flag + a coarse category
 * ONLY — never the offending text (D-07). Zero model calls (COST-01). Defensive:
 * empty / null / undefined / non-string input returns `{ flagged:false, category:null }`
 * without throwing.
 *
 * @param {*} text - The untrusted player reply.
 * @returns {{ flagged: boolean, category: string|null }}
 */
export function detectRedLines(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { flagged: false, category: null };
  }
  // Normalize away zero-width / format / combining obfuscation BEFORE matching so
  // a slur split by invisible characters (`n​ig​ger`) collapses to the base
  // letters the matcher catches. We match on the normalized copy but never carry
  // any text out (D-07 — return category-only).
  const normalized = normalizeForRedLines(text);
  const matches = redLinesMatcher.getAllMatches(normalized, /* sorted */ true);
  if (matches.length === 0) {
    return { flagged: false, category: null };
  }
  const { phraseMetadata } = redLinesDataset.getPayloadWithPhraseMetadata(matches[0]);
  return { flagged: true, category: categoryForMatch(phraseMetadata) };
}
