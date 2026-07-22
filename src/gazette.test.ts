// Gazette verdict-card helpers — pure-logic tests (no canvas).
// Spec: hq/outputs/gazette-verdict-card-spec.md (Direction 02 + day numbers).
import { describe, expect, it } from 'vitest';
import {
  GAZETTE,
  gazetteKicker,
  gazetteMeta,
  headlineText,
  mastheadDate,
  pickHeadlineSize,
  republicanMonth,
} from './gazette';

// Synthetic measurer: width scales linearly with chars and px (0.6em average glyph).
const fakeMeasure = (text: string, px: number) => text.length * px * 0.6;

describe('republicanMonth', () => {
  it('maps mid-month dates across all 12 Gregorian months', () => {
    const expected = [
      'Nivôse', 'Pluviôse', 'Ventôse', 'Germinal', 'Floréal', 'Prairial',
      'Messidor', 'Thermidor', 'Fructidor', 'Vendémiaire', 'Brumaire', 'Frimaire',
    ];
    for (let m = 0; m < 12; m++) expect(republicanMonth(new Date(2026, m, 10))).toBe(expected[m]);
  });

  it('rolls into the next Republican month from the 19th', () => {
    expect(republicanMonth(new Date(2026, 6, 10))).toBe('Messidor');
    expect(republicanMonth(new Date(2026, 6, 22))).toBe('Thermidor'); // the mock's anchor
    expect(republicanMonth(new Date(2026, 11, 25))).toBe('Nivôse'); // Dec wraps to index 0
  });
});

describe('mastheadDate', () => {
  it('formats day number with the Republican month', () => {
    expect(mastheadDate(37, new Date(2026, 6, 22))).toBe('№ 37 · Thermidor');
  });
});

describe('gazetteKicker — the color-reservation rule lives here', () => {
  it('win kicker is gold-filled with print-black text and never crimson', () => {
    const k = gazetteKicker('won');
    expect(k.label).toBe('EXCLUSIVE · CONCESSION');
    expect(k.fill).toBe(GAZETTE.GOLD);
    expect(k.ink).toBe(GAZETTE.PRINT);
    expect(JSON.stringify(k)).not.toContain(GAZETTE.CRIMSON);
  });

  it('loss kicker is crimson-filled with newsprint text and never gold', () => {
    const k = gazetteKicker('lost');
    expect(k.label).toBe('SCANDALE · DISMISSED');
    expect(k.fill).toBe(GAZETTE.CRIMSON);
    expect(k.ink).toBe(GAZETTE.PAPER);
    expect(JSON.stringify(k)).not.toContain(GAZETTE.GOLD);
  });
});

describe('headlineText', () => {
  it('uppercases the hero line', () => {
    expect(headlineText('won', 'your ego needs no flattery')).toBe(
      'YOUR EGO NEEDS NO FLATTERY',
    );
  });

  it('quotes the ruling on a loss only', () => {
    expect(headlineText('lost', 'better flattery from the horse')).toBe(
      '“BETTER FLATTERY FROM THE HORSE”',
    );
    expect(headlineText('won', 'a winning line')).not.toContain('“');
  });
});

describe('gazetteMeta', () => {
  const base = { turnsUsed: 2, tierLabel: 'Fair Fight', winStreak: 0, maxTurns: 3 };

  it('win meta carries outcome in text with of-N turns', () => {
    expect(gazetteMeta('won', base)).toBe('Won in 2 of 3 turns · Fair Fight');
  });

  it('loss meta carries dismissal in text', () => {
    expect(gazetteMeta('lost', { ...base, turnsUsed: 3 })).toBe(
      'Dismissed in 3 turns · Fair Fight',
    );
  });

  it('loss singular turn reads as one turn', () => {
    expect(gazetteMeta('lost', { ...base, turnsUsed: 1 })).toBe(
      'Dismissed in 1 turn · Fair Fight',
    );
  });

  it('singular turn and streak suffix', () => {
    expect(gazetteMeta('won', { ...base, turnsUsed: 1, winStreak: 4 })).toBe(
      'Won in 1 of 3 turns · Fair Fight · 4-day streak',
    );
  });
});

describe('pickHeadlineSize — step down, never truncate', () => {
  const maxW = 880;

  it('short headline stays at the 96px ceiling', () => {
    const r = pickHeadlineSize(fakeMeasure, 'SHORT AND SHARP', maxW);
    expect(r.px).toBe(96);
    expect(r.lines).toBeLessThanOrEqual(4);
  });

  it('long headline steps down until it fits four lines', () => {
    const long = 'YOUR EGO NEEDS NO FLATTERY SAID THE BEST FED MAN IN FRANCE';
    const r = pickHeadlineSize(fakeMeasure, long, maxW);
    expect([84, 72, 64]).toContain(r.px);
    expect(r.lines).toBeLessThanOrEqual(4);
  });

  it('absurdly long headline lands on the 64px floor and reports its true line count', () => {
    const absurd = Array(40).fill('MAGNIFICENT').join(' ');
    const r = pickHeadlineSize(fakeMeasure, absurd, maxW);
    expect(r.px).toBe(64);
    expect(r.lines).toBeGreaterThan(4); // floor reached; global card scale handles the rest
  });

  it('never returns a size where a smaller step would have been unnecessary', () => {
    // Monotonicity guard: line count at the chosen px must exceed 4 at the next px up.
    const long =
      'A HEADLINE PRECISELY ENGINEERED TO REQUIRE STEPPING DOWN A SINGLE NOTCH FOR THE FOUR LINE BUDGET LIMIT';
    const r = pickHeadlineSize(fakeMeasure, long, maxW);
    if (r.px < 96) {
      const steps = [96, 84, 72, 64];
      const nextUp = steps[steps.indexOf(r.px) - 1];
      const atNextUp = pickHeadlineSize(fakeMeasure, long, maxW, { steps: [nextUp] });
      expect(atNextUp.lines).toBeGreaterThan(4);
    }
  });
});
