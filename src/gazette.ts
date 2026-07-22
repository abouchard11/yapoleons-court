// Gazette verdict-card helpers — the pure logic behind the Direction-02 card
// (hq/outputs/gazette-verdict-card-spec.md, chosen 2026-07-22). Everything here is
// canvas-free and unit-tested in gazette.test.ts; share.ts owns the actual drawing.
//
// The color-reservation rule (Pitfall 5) is ENCODED here in gazetteKicker: GOLD may
// only ever appear in the 'won' branch and CRIMSON only in the 'lost' branch. The
// kicker is the single win/loss color decision on the gazette card; outcome is ALSO
// always carried in its text (a11y — never color alone).

export type Outcome = 'won' | 'lost';

// ── Gazette palette (canvas light-palette lock — identical for every recipient) ──
export const GAZETTE = {
  PAPER: '#F2EFE6', // newsprint ground
  PRINT: '#141210', // masthead, headline, rules
  MUTED: '#55504A', // meta strip
  GOLD: '#E8B84B', // WIN key only
  CRIMSON: '#C8302A', // LOSS key only
} as const;

// ── Masthead date (the collectible mechanic: № {day} · {Republican month}) ──

/** Gregorian month (mid-month) → French Republican month. Each Republican month
 *  begins around the 19th–22nd of the Gregorian one, so dates on or after the
 *  19th roll into the next entry. Flavor with a straight face — two lines of
 *  arithmetic, not an almanac dependency. */
const REPUBLICAN_MONTHS = [
  'Nivôse', // most of Jan
  'Pluviôse', // most of Feb
  'Ventôse', // most of Mar
  'Germinal', // most of Apr
  'Floréal', // most of May
  'Prairial', // most of Jun
  'Messidor', // most of Jul
  'Thermidor', // most of Aug
  'Fructidor', // most of Sep
  'Vendémiaire', // most of Oct
  'Brumaire', // most of Nov
  'Frimaire', // most of Dec
];

export function republicanMonth(date: Date): string {
  const shift = date.getDate() >= 19 ? 1 : 0;
  return REPUBLICAN_MONTHS[(date.getMonth() + shift) % 12];
}

/** "№ 37 · Thermidor" — the day number is the series/collection key. */
export function mastheadDate(dayNumber: number, date: Date): string {
  return `№ ${dayNumber} · ${republicanMonth(date)}`;
}

// ── Kicker chip (the one win/loss color decision on the card) ──

export interface Kicker {
  label: string;
  fill: string;
  ink: string;
}

export function gazetteKicker(outcome: Outcome): Kicker {
  return outcome === 'won'
    ? { label: 'EXCLUSIVE · CONCESSION', fill: GAZETTE.GOLD, ink: GAZETTE.PRINT }
    : { label: 'SCANDALE · DISMISSED', fill: GAZETTE.CRIMSON, ink: GAZETTE.PAPER };
}

// ── Headline ──

/** Uppercase the hero line; quote it only when it is Yapoleon's ruling (a loss).
 *  A win headline is the player's own words run as the day's scoop, unquoted. */
export function headlineText(outcome: Outcome, heroLine: string): string {
  const up = heroLine.toUpperCase();
  return outcome === 'lost' ? `“${up}”` : up;
}

export interface HeadlineFit {
  px: number;
  lines: number;
}

export interface HeadlineFitOptions {
  steps?: number[];
  maxLines?: number;
}

/**
 * Length-aware headline sizing: try each step (96 → 84 → 72 → 64) and take the
 * first whose wrapped line count fits the budget (4 lines). If even the floor
 * overflows, return the floor WITH its true line count — the caller's uniform
 * card downscale absorbs the rest. Ellipsis is forbidden: step down, never truncate.
 *
 * `measure(text, px)` is injected so this stays canvas-free and testable; the
 * renderer passes a bound ctx.measureText and tests pass a synthetic ruler.
 */
export function pickHeadlineSize(
  measure: (text: string, px: number) => number,
  text: string,
  maxW: number,
  opts: HeadlineFitOptions = {},
): HeadlineFit {
  const steps = opts.steps ?? [96, 84, 72, 64];
  const maxLines = opts.maxLines ?? 4;

  const countLines = (px: number): number => {
    const words = text.split(' ');
    let line = '';
    let lines = 1;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (measure(test, px) > maxW && line) {
        line = w;
        lines++;
      } else {
        line = test;
      }
    }
    return lines;
  };

  let last: HeadlineFit = { px: steps[steps.length - 1], lines: 0 };
  for (const px of steps) {
    const lines = countLines(px);
    last = { px, lines };
    if (lines <= maxLines) return last;
  }
  return last; // floor reached; report the true (over-budget) line count.
}

// ── Meta strip ──

export interface MetaInput {
  turnsUsed: number;
  tierLabel: string;
  winStreak: number;
  maxTurns: number;
}

/** Outcome in TEXT (a11y): "Won in N of M turns · Tier[ · S-day streak]" /
 *  "Dismissed in N turns · Tier[ · S-day streak]". */
export function gazetteMeta(outcome: Outcome, input: MetaInput): string {
  const turnWord = input.turnsUsed === 1 ? 'turn' : 'turns';
  const lead =
    outcome === 'won'
      ? `Won in ${input.turnsUsed} of ${input.maxTurns} turns`
      : `Dismissed in ${input.turnsUsed} ${turnWord}`;
  const streak = input.winStreak > 0 ? ` · ${input.winStreak}-day streak` : '';
  return `${lead} · ${input.tierLabel}${streak}`;
}
