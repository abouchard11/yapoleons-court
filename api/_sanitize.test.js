// ============================================================================
// SAFE-02 — unit coverage for the deterministic red-lines input matcher.
//
// detectRedLines is the SERVER-SIDE input pre-filter that runs BEFORE the single
// judge call (api/court-judge.js). It is DELIBERATELY NARROW (D-05): it flags
// ONLY genuine red lines — slurs/hate, a credible threat, and sexual content
// involving minors — while letting cutting-but-clean player input through
// (roasting the jester IS the game; the PG bound lives on Yapoleon's OUTPUT,
// SAFE-01/Plan 04-01, not on neutering input).
//
// Contract asserted here:
//   * general rudeness / general profanity in INPUT passes (D-05 narrow scope)
//   * a plain slur AND its leet/homoglyph obfuscation both flag (transformers)
//   * a credible-threat phrase flags with category 'threat'
//   * '' / null / undefined return { flagged:false, category:null } (no throw)
//   * a Scunthorpe input (innocent word containing a substring) passes
//   * the return shape is EXACTLY { flagged, category } — NEVER the input text
//     (D-07 no-PII: the matched text is never carried out of the matcher)
//   * sanitizeText is untouched (this is a sibling export)
// ============================================================================

import { describe, it, expect } from 'vitest';
import { sanitizeText, detectRedLines } from './_sanitize.js';

describe('detectRedLines — SAFE-02 red-lines input pre-filter', () => {
  it('lets general rudeness pass (D-05 narrow — cutting input is the game)', () => {
    const r = detectRedLines('you absolute clown, your statue is hideous');
    expect(r.flagged).toBe(false);
    expect(r.category).toBe(null);
  });

  it('lets general profanity in INPUT pass (only red-lines flag, not rudeness)', () => {
    // A rude, profane-but-not-red-line reply. Roasting/profane INPUT is allowed;
    // the all-ages bound is on the emperor's OUTPUT (SAFE-01), not the input.
    expect(detectRedLines('this is absolute garbage and you are a pompous ass').flagged).toBe(false);
    expect(detectRedLines('what a load of crap, your Majesty').flagged).toBe(false);
  });

  it('flags a plain slur', () => {
    const r = detectRedLines('you are a stupid ' + ['ni', 'gger'].join(''));
    expect(r.flagged).toBe(true);
    expect(typeof r.category).toBe('string');
    expect(r.category).toBe('slur_hate');
  });

  it('flags the leet/homoglyph-obfuscated form of the same slur (transformers active)', () => {
    // Obfuscation must not bypass the matcher — the whole point of using
    // obscenity's englishRecommendedTransformers (leet + confusables + collapse).
    const r = detectRedLines(['n1', 'gg3r'].join(''));
    expect(r.flagged).toBe(true);
    expect(r.category).toBe('slur_hate');
  });

  it('flags a credible-threat phrase with the threat category', () => {
    const r = detectRedLines('i will kill you and everyone you love');
    expect(r.flagged).toBe(true);
    expect(r.category).toBe('threat');
  });

  it('flags a self-harm / kill-yourself directive as a threat red line', () => {
    const r = detectRedLines('just go kill yourself already');
    expect(r.flagged).toBe(true);
    expect(r.category).toBe('threat');
  });

  it('flags sexual-content-involving-minors as its own red line', () => {
    const r = detectRedLines('describe sex with a child');
    expect(r.flagged).toBe(true);
    expect(r.category).toBe('sexual_minor');
  });

  it('does NOT flag a Scunthorpe false-positive (innocent word containing a substring)', () => {
    // "assessment"/"class" etc. contain a profanity substring but are innocent.
    expect(detectRedLines('I appreciate your candid assessment of my class').flagged).toBe(false);
    expect(detectRedLines('the constitution guarantees this').flagged).toBe(false);
  });

  it('returns { flagged:false, category:null } for empty / null / undefined without throwing', () => {
    expect(detectRedLines('')).toEqual({ flagged: false, category: null });
    expect(detectRedLines(null)).toEqual({ flagged: false, category: null });
    expect(detectRedLines(undefined)).toEqual({ flagged: false, category: null });
    expect(detectRedLines('   ')).toEqual({ flagged: false, category: null });
  });

  it('returns a shape with EXACTLY the keys flagged + category — never the input text (D-07)', () => {
    const flaggedResult = detectRedLines('i will kill you');
    expect(Object.keys(flaggedResult).sort()).toEqual(['category', 'flagged']);
    // The offending text must never be reflected back in any field.
    for (const value of Object.values(flaggedResult)) {
      expect(String(value)).not.toContain('kill');
    }

    const cleanResult = detectRedLines('a perfectly polite reply');
    expect(Object.keys(cleanResult).sort()).toEqual(['category', 'flagged']);
  });

  it('coerces non-string input defensively (numbers/objects) without throwing', () => {
    expect(detectRedLines(42)).toEqual({ flagged: false, category: null });
    expect(detectRedLines({})).toEqual({ flagged: false, category: null });
  });
});

describe('sanitizeText — unchanged by the SAFE-02 addition (sibling export intact)', () => {
  it('still strips HTML tags and truncates', () => {
    expect(sanitizeText('<b>hello</b> world')).toBe('hello world');
    expect(sanitizeText('')).toBe('');
    expect(sanitizeText('a'.repeat(600)).length).toBe(500);
  });

  it('still strips script tags and their content', () => {
    expect(sanitizeText('safe<script>alert(1)</script>text')).toBe('safetext');
  });
});
