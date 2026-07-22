// Share flow — FORK of yapword's App-Review-survived canvas + Web Share cascade
// (yapword's share-handler factory + its canvas card renderer). Reshaped for
// Yapoleon's Court (Phase 2, plan 02-05 / SHARE-01/02/03, D-01/D-02/D-05/D-06).
//
// What carries over VERBATIM from yapword: the wrapText + wrapped-height-measure
// helpers, the ShareParts {title,text,url} type, the explicit per-weight
// document.fonts.load(...) font-readiness step (the WKWebView fix — Apple Bug
// #31423200; the fonts-ready promise resolves prematurely there), and the
// web-first share cascade (the canShare({files}) gate then navigator.share then
// blob download + toast).
//
// What is RESHAPED / OMITTED for the Court:
//   • FIXED 1080×1080 square (D-01), not yapword's W=1080 auto-height card.
//   • TYPOGRAPHIC, NO portrait/crest (D-02) — yapword's image-loader, the hero
//     image, the radial-gradient hero, and the whole Wordle board path (the tile
//     grid, the answer-word spoiler-hiding helpers, the triple-crown + challenge
//     card builders) are all GONE. The card is pure type.
//   • The native iOS share branch (the @capacitor/* share plugin) is left out
//     (web-first, D-05). It is NOT in Court's package.json — importing it would
//     break the build. The 8-second native cleanup buffer is a comment-only note
//     for when the native path lands later.
//   • VAL-02 share-rate analytics (Plan 04-04) are now WIRED here via the trackEvent
//     dual-emit bridge (D-12 two honest metrics): card_generated (reliable — fired when
//     the blob is drawn, the kill-criteria denominator) + share_attempted (best-effort —
//     fired at sheet-open/download BEFORE the await so a user-cancel does not un-count it).
//     Neither carries reply text — outcome/turns/method only, keyed on the anonymous
//     player_id (no PII). share_attempted is NEVER "confirmed shares" (Pitfall 6).

import { trackEvent } from './gemini-client';
import { getPlayerId } from './court-identity';
import { MAX_TURNS } from './config';
import {
  GAZETTE,
  gazetteKicker,
  gazetteMeta,
  headlineText,
  mastheadDate,
  pickHeadlineSize,
} from './gazette';

// ── Types ──

/** The caption + url that travel WITH the shared PNG (D-06). Reused VERBATIM from
 *  yapword's ShareParts (yapword/src/share.ts:38) — exactly {title,text,url}. */
export type ShareParts = { title: string; text: string; url: string };

/** The card payload assembled by Plan 06 from the live end-of-round RoundState and
 *  the court-can-play winStreak, then passed into drawVerdictCard. */
export interface VerdictCardData {
  outcome: 'won' | 'lost';
  /** demand.scene (the day's demand framing — the setup, always available). */
  demandScene: string;
  /** WIN: the player's winning reply (the brag — Court has no single "answer", so
   *  showing it is a brag, not a spoiler, D-02).
   *  LOSS: Yapoleon's savage dismissal line (the shareable hero — the player's
   *  failed attempts are NOT rendered, D-04). */
  heroLine: string;
  /** WIN only: the judge's final reaction — Yapoleon's grudging concession line. */
  concessionLine?: string;
  /** round.turns.length. */
  turnsUsed: number;
  /** 'Fair Fight' (from demand.tier). */
  tierLabel: string;
  /** Consecutive days won (live-derived server fact, D-03 — from court-can-play). */
  winStreak: number;
  /** The daily puzzle index (round.day) — the gazette's "№ {day}" series key. */
  day: number;
}

// ── Canvas light-palette lock (UI-SPEC) ──
// The gazette palette lives in gazette.ts (GAZETTE) — hard-coded so the card looks
// IDENTICAL for every recipient regardless of the sharer's dark/light appearance.
// Color reservation (Pitfall 5) is ENCODED in gazetteKicker (unit-tested): the
// kicker chip is the ONLY win/loss color decision on the card — gold never touches
// a dismissal, crimson never touches a concession, outcome always in TEXT too.
const DECK_INK = '#3C3831'; // deck (demand framing) — darker than GAZETTE.MUTED

// ── Canvas geometry (its own 1080px pixel budget — NOT the in-app 4px grid) ──
const SIZE = 1080; // FIXED square: width AND height are literal 1080 (D-01).
const PAD_TOP = 80;
const PAD_BOTTOM = 80;
const BORDER = 28; // outer-frame inset
const BORDER_W = 14; // frame stroke width
const WRAP_MAX_W = SIZE - 200; // 880px — keeps wrapped lines off the border.

// Font family names — MUST match the @font-face entries in src/index.css.
const FAMILY_DISPLAY = '"Bricolage Grotesque", system-ui, sans-serif';
const FAMILY_BODY = 'Inter, system-ui, sans-serif';
// Typewriter voice for the masthead date + meta strip. Deliberately a SYSTEM stack
// (no bundled file): American Typewriter on Apple platforms, Courier elsewhere —
// decorative flavor where a fallback shift is acceptable (unlike the headline).
const FAMILY_TYPEWRITER = '"American Typewriter", "Courier New", Courier, monospace';

// ── Verbatim from yapword/src/game.ts (battle-tested; copy unchanged) ──

/** Draw `text` wrapped to `maxW`, centered at `cx`, starting at baseline `top`,
 *  advancing by `lh` per line. (yapword/src/game.ts:979-994 — VERBATIM.) */
function wrapText(
  x: CanvasRenderingContext2D,
  text: string,
  cx: number,
  top: number,
  maxW: number,
  lh: number,
) {
  const words = text.split(' ');
  let line = '';
  let y = top;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (x.measureText(test).width > maxW && line) {
      x.fillText(line, cx, y);
      line = w;
      y += lh;
    } else {
      line = test;
    }
  }
  if (line) x.fillText(line, cx, y);
}

/** Measure the height of wrapped text WITHOUT drawing it (the two-pass
 *  measure-then-draw the laid-out card needs). (yapword/src/game.ts:1009-1026 — VERBATIM.) */
function measureWrappedHeight(
  x: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  lh: number,
): number {
  const words = text.split(' ');
  let line = '';
  let lines = 1;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (x.measureText(test).width > maxW && line) {
      line = w;
      lines++;
    } else {
      line = test;
    }
  }
  return lines * lh;
}

// ── The caption builder (D-06; fork of yapword buildShareParts, emoji-grid stripped) ──

/**
 * The in-voice caption + court.yapoleon.com link that travel WITH the card PNG.
 *
 * ── IN-VOICE DRAFTS (02-06) — pending a voice-review (D-06) ──
 * Drafted in register (Wilde/Twain epigram, ego-is-the-joke, all-ages/PG,
 * third-person "Yapoleon", no emoji for clean OS share sheets). The savagery targets
 * the GAME / Yapoleon's own deniable ego — NEVER the player or protected traits (D-04;
 * must not obviously fail the Phase-4 safe-savagery bound). Drafted, then
 * voice-reviewed: these are NOT final. The caption + URL carry NO PII (anonymous play —
 * T-02-14 / SAFE-03, COPPA-safe).
 *
 *   WIN  — a brag the winner posts; the joke is Yapoleon's grudging, deniable defeat.
 *          Chosen draft:  "Yapoleon conceded today. He is already drafting the version
 *                          of events where he didn't."
 *          Alternate:     "Today Yapoleon granted his favor — and insists it was always
 *                          the plan."
 *   LOSS — bait the friend with the setup; let the loser save face by framing it as a
 *          shared challenge. The barb is the Emperor's bar, not the player.
 *          Chosen draft:  "Yapoleon remains unmoved. His favor is still on the table —
 *                          go on, be the one who earns it."
 *          Alternate:     "Yapoleon was not charmed today. He doubts you'll fare better
 *                          — prove the Emperor wrong."
 */
export function buildVerdictShareParts(outcome: 'won' | 'lost'): ShareParts {
  return {
    title: "Yapoleon's Court",
    text:
      outcome === 'won'
        ? // WIN (in-voice draft — pending 02-06 voice-review):
          'Yapoleon conceded today. He is already drafting the version of events where he didn’t.'
        : // LOSS (in-voice draft — pending 02-06 voice-review):
          'Yapoleon remains unmoved. His favor is still on the table — go on, be the one who earns it.',
    url: 'https://court.yapoleon.com/',
  };
}

// ── The 1080×1080 gazette verdict-card renderer (Direction 02, 2026-07-22) ──

/**
 * Render the concession (win) or dismissal (loss) card as the day's front page of
 * LE GAZETTE DU COURT (design: hq/outputs/gazette-verdict-card-spec.md).
 *
 * Composition, top → bottom on newsprint:
 *   masthead row ("LE GAZETTE DU COURT" left · "№ {day} · {Republican month}" right)
 *   → 8px rule → kicker chip (the one win/loss color: gold EXCLUSIVE·CONCESSION /
 *   crimson SCANDALE·DISMISSED) → the hero line as an UPPERCASE headline
 *   (length-aware 96→64px, ≤4 lines, never truncated) → the demand framing as an
 *   italic deck → bottom rule → meta strip (outcome in text) + court.yapoleon.com.
 *
 * Fit guarantee: the headline steps down first (pickHeadlineSize); if the middle
 * stack STILL overflows (marathon demand text), one uniform downscale pass absorbs
 * the rest — smaller fonts re-wrap to ≤ the same line count, so the second measure
 * is exact. Nothing is ever clipped or ellipsized.
 *
 * Throws on canvas/toBlob failure — the caller (Plan 06) surfaces the error state
 * ("The Emperor's portraitist faltered.") rather than swallowing it.
 */
export async function drawVerdictCard(data: VerdictCardData): Promise<Blob> {
  const kicker = gazetteKicker(data.outcome);
  const headline = headlineText(data.outcome, data.heroLine);
  const metaLine = gazetteMeta(data.outcome, {
    turnsUsed: data.turnsUsed,
    tierLabel: data.tierLabel,
    winStreak: data.winStreak,
    maxTurns: MAX_TURNS,
  });
  const dateLine = mastheadDate(data.day, new Date());

  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const x = c.getContext('2d');
  if (!x) throw new Error('Canvas unsupported');

  // Font-readiness (WKWebView fix — Apple Bug #31423200): load each bundled
  // weight actually drawn. The typewriter stack is system fonts — nothing to load.
  try {
    await Promise.all([
      document.fonts.load('700 96px "Bricolage Grotesque"'), // headline (any size loads the face)
      document.fonts.load('700 46px "Bricolage Grotesque"'), // masthead
      document.fonts.load('700 26px Inter'), // kicker
      document.fonts.load('italic 500 30px Inter'), // deck
      document.fonts.load('700 24px Inter'), // footer URL
    ]);
  } catch {
    /* non-fatal — canvas falls back to system-ui */
  }

  const MX = 100; // side margin; keeps every band on the same 880px measure as WRAP_MAX_W
  const MW = SIZE - MX * 2;

  // ── Newsprint ground ──
  x.fillStyle = GAZETTE.PAPER;
  x.fillRect(0, 0, SIZE, SIZE);
  x.textBaseline = 'alphabetic';

  // ── Masthead row + rule (fixed band) ──
  x.fillStyle = GAZETTE.PRINT;
  x.textAlign = 'left';
  x.font = `700 46px ${FAMILY_DISPLAY}`;
  x.fillText('LE GAZETTE DU COURT', MX, 128);
  x.textAlign = 'right';
  x.font = `500 26px ${FAMILY_TYPEWRITER}`;
  x.fillText(dateLine, SIZE - MX, 128);
  x.fillRect(MX, 152, MW, 8);

  // ── Bottom band (fixed): rule + meta strip + URL ──
  const RULE2_Y = 930;
  x.fillRect(MX, RULE2_Y, MW, 2);
  // If meta + URL would collide on the 880px measure, shrink both a notch (no clipping).
  let bottomPx = 24;
  x.font = `500 ${bottomPx}px ${FAMILY_TYPEWRITER}`;
  const metaW = x.measureText(metaLine).width;
  x.font = `700 ${bottomPx}px ${FAMILY_BODY}`;
  const urlW = x.measureText('court.yapoleon.com').width;
  if (metaW + urlW + 24 > MW) bottomPx = 21;
  const bottomBaseline = RULE2_Y + 58;
  x.textAlign = 'left';
  x.fillStyle = GAZETTE.MUTED;
  x.font = `500 ${bottomPx}px ${FAMILY_TYPEWRITER}`;
  x.fillText(metaLine, MX, bottomBaseline);
  x.textAlign = 'right';
  x.fillStyle = GAZETTE.PRINT;
  x.font = `700 ${bottomPx}px ${FAMILY_BODY}`;
  x.fillText('court.yapoleon.com', SIZE - MX, bottomBaseline);

  // ── Middle stack: kicker chip → headline → deck (top-aligned, newspaper-style) ──
  const stackTop = 160 + 56; // below the masthead rule, one breath down
  const stackBottom = RULE2_Y - 48;
  const avail = stackBottom - stackTop;

  // Headline size steps down FIRST (the length-aware move)…
  const measurePx = (text: string, px: number): number => {
    x.font = `700 ${px}px ${FAMILY_DISPLAY}`;
    return x.measureText(text).width;
  };
  const fit = pickHeadlineSize(measurePx, headline, WRAP_MAX_W);

  // …then one uniform downscale absorbs anything the floor could not (never clip).
  function measureStack(scale: number, x2: CanvasRenderingContext2D) {
    const kickerFont = 26 * scale;
    const kickerH = 54 * scale;
    const gapAfterKicker = 52 * scale;
    const heroPx = fit.px * scale;
    const heroLH = heroPx * 1.12;
    x2.font = `700 ${heroPx}px ${FAMILY_DISPLAY}`;
    const heroH = measureWrappedHeight(x2, headline, WRAP_MAX_W, heroLH);
    const gapAfterHero = 44 * scale;
    const deckPx = 30 * scale;
    const deckLH = 44 * scale;
    x2.font = `italic 500 ${deckPx}px ${FAMILY_BODY}`;
    const deckH = measureWrappedHeight(x2, data.demandScene, WRAP_MAX_W, deckLH);
    const contentH = kickerH + gapAfterKicker + heroH + gapAfterHero + deckH;
    return { scale, kickerFont, kickerH, gapAfterKicker, heroPx, heroLH, heroH, gapAfterHero, deckPx, deckLH, deckH, contentH };
  }
  let m = measureStack(1, x);
  if (m.contentH > avail) m = measureStack(avail / m.contentH, x);

  let y = stackTop;

  // Kicker chip — the single win/loss color decision (gazetteKicker, unit-tested).
  x.font = `700 ${m.kickerFont}px ${FAMILY_BODY}`;
  const kickerTextW = x.measureText(kicker.label).width;
  const chipW = kickerTextW + 56 * m.scale;
  x.fillStyle = kicker.fill;
  x.fillRect(SIZE / 2 - chipW / 2, y, chipW, m.kickerH);
  x.fillStyle = kicker.ink;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(kicker.label, SIZE / 2, y + m.kickerH / 2 + 1);
  x.textBaseline = 'alphabetic';
  y += m.kickerH + m.gapAfterKicker;

  // Headline — the hero line as the day's scoop (print black, never the key color).
  x.fillStyle = GAZETTE.PRINT;
  x.font = `700 ${m.heroPx}px ${FAMILY_DISPLAY}`;
  wrapText(x, headline, SIZE / 2, y + m.heroPx, WRAP_MAX_W, m.heroLH);
  y += m.heroH + m.gapAfterHero;

  // Deck — the demand framing as an italic newspaper deck.
  x.fillStyle = DECK_INK;
  x.font = `italic 500 ${m.deckPx}px ${FAMILY_BODY}`;
  wrapText(x, data.demandScene, SIZE / 2, y + m.deckPx, WRAP_MAX_W, m.deckLH);

  // ── Canvas → PNG Blob ──
  return await new Promise<Blob>((resolve, reject) => {
    c.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas toBlob failed'));
    }, 'image/png');
  });
}

// ── The web-first share cascade (D-05; fork of yapword handleSaveCard web branch) ──

/**
 * One-tap share of the verdict card. Draws the PNG, then:
 *   • mobile (navigator.canShare({files}) === true): hand the PNG + caption + URL
 *     to the OS share sheet via navigator.share. A user-cancel (AbortError) is a
 *     silent no-op.
 *   • desktop / no-canShare: download the blob + show a "Card saved!" toast.
 *
 * The caption + URL (ShareParts) carry NO PII — anonymous play (T-02-14).
 *
 * NOTE (native, deferred — D-05): the native iOS path is NOT built this phase
 * (the native Capacitor share plugin is intentionally absent from package.json).
 * When native lands, the same drawVerdictCard Blob is written to the cache
 * directory and handed to the native share sheet; that path needs an ~8-second
 * setTimeout cleanup buffer before deleting the cached file (native share resolves
 * when the sheet OPENS, not when a slow consumer like iMessage/Photos finishes
 * reading). Kept as a note only.
 *
 * Errors from drawVerdictCard are NOT swallowed — they propagate so the caller
 * (Plan 06) can render "The Emperor's portraitist faltered." A user-cancel of the
 * OS share sheet (AbortError) is the one case that returns silently.
 */
export async function shareVerdict(
  data: VerdictCardData,
  parts: ShareParts,
  showToast: (msg: string) => void,
  day?: number,
): Promise<void> {
  const blob = await drawVerdictCard(data); // throws on render failure (surfaced upstream)

  // VAL-02: card_generated is the RELIABLE share metric (D-12) — the blob was actually
  // drawn (a render failure throws above, before this line, so it never fires on a failed
  // draw). This is the kill-criteria denominator (card_generated / completed rounds), NOT
  // share_attempted. outcome + turns_used only (from data) — no reply text, no PII.
  trackEvent('card_generated', { player_id: getPlayerId(), outcome: data.outcome, turns_used: data.turnsUsed });

  const filename = `court-${day ?? 'verdict'}.png`;
  const file = new File([blob], filename, { type: 'image/png' });

  // D-05: only the OS share sheet on a TOUCH/mobile device. `canShare({files})` is
  // true on desktop Chrome (macOS/Windows) too, so gating on it alone wrongly opens
  // the native share sheet there; require a touch/coarse pointer so desktop falls
  // through to the download path. iOS / Capacitor WKWebView reports touch + coarse
  // pointer, so the native sheet is still used on the primary target.
  const prefersOsShare =
    typeof navigator !== 'undefined' &&
    (navigator.maxTouchPoints > 0 ||
      (typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches));

  if (
    prefersOsShare &&
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    // VAL-02: share_attempted is best-effort (D-12) — fired at the point of INVOKING the OS
    // sheet, BEFORE the await, so a user-cancel (AbortError below) does NOT retroactively
    // un-count it (Pitfall 6). navigator.share resolves on sheet-OPEN, not send — this is an
    // ATTEMPT, never a "confirmed share". method distinguishes the OS-sheet path from the
    // desktop download. No reply text, no PII.
    trackEvent('share_attempted', { player_id: getPlayerId(), outcome: data.outcome, method: 'os_share' });
    try {
      await navigator.share({ title: parts.title, text: parts.text, files: [file] });
      return;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return; // user-cancel = silent no-op
      // Any other share failure falls through to the download fallback below.
    }
  }

  // Desktop / no-canShare fallback: download the blob.
  // VAL-02: the download branch's share_attempted (method:'download'). Fired before the
  // click for symmetry with the OS-sheet path (best-effort, directional only).
  trackEvent('share_attempted', { player_id: getPlayerId(), outcome: data.outcome, method: 'download' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Card saved!');
}
