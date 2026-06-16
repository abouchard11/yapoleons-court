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
//   • The Phase-4 share-rate analytics events are OMITTED — VAL-02 instrumentation
//     is a later phase (CONTEXT Deferred), not Phase 2.

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
}

// ── Canvas light-palette lock (UI-SPEC) ──
// Hard-coded so the card looks IDENTICAL for every recipient regardless of the
// sharer's dark/light appearance (yapword game.ts:1206-1209 light-palette lock).
// Color reservation (Pitfall 5): GOLD = WIN key only (MUST NOT touch the dismissal
// card); CRIMSON = LOSS key only (MUST NOT touch the concession card). Win/loss is
// ALSO carried by TEXT (a11y), never by color alone.
const CREAM = '#FBF6EC'; // background
const NAVY = '#1B2A4A'; // dominant ink (wordmark, hero, meta)
const INK = '#1F1C16'; // warm near-black body (demand framing, footer)
const GOLD = '#E8B84B'; // WIN key only
const CRIMSON = '#C8302A'; // LOSS key only

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
 * ── IN-VOICE DRAFTS (02-06) — pending the operator's Task-2 voice-review (D-06) ──
 * the author-drafted in register (Wilde/Twain epigram, ego-is-the-joke, all-ages/PG,
 * third-person "Yapoleon", no emoji for clean OS share sheets). The savagery targets
 * the GAME / Yapoleon's own deniable ego — NEVER the player or protected traits (D-04;
 * must not obviously fail the Phase-4 safe-savagery bound). the author drafts → the author
 * approves: these are NOT final. The caption + URL carry NO PII (anonymous play —
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

// ── The 1080×1080 typographic verdict-card renderer ──

/**
 * Render the concession (win) or dismissal (loss) card to a 1080×1080 PNG Blob.
 *
 * Composition (centered, top→bottom): wordmark "Yapoleon's Court" → demand
 * framing (the setup) → hero line (the winning line on a win / the savage
 * dismissal line on a loss) → concession line (WIN only) → meta line → footer URL.
 * The hero line is the largest emotional beat (UI-SPEC hierarchy).
 *
 * Throws on canvas/toBlob failure — the caller (Plan 06) surfaces the error state
 * ("The Emperor's portraitist faltered.") rather than swallowing it.
 */
export async function drawVerdictCard(data: VerdictCardData): Promise<Blob> {
  const won = data.outcome === 'won';
  // Color reservation (Pitfall 5): the win key is GOLD and the loss key is CRIMSON.
  // `accent` is the ONLY place the win/loss key color is chosen — gold never
  // touches a dismissal card and crimson never touches a concession card because
  // each card only ever reads its own `accent`.
  const accent = won ? GOLD : CRIMSON;

  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const x = c.getContext('2d');
  if (!x) throw new Error('Canvas unsupported');

  // Font-readiness (WKWebView fix — yapword game.ts:1119-1133). Explicitly load
  // EACH weight/size actually drawn below; `document.fonts.ready` resolves
  // prematurely on WKWebView (Apple Bug #31423200). Non-fatal: a failed load lets
  // the canvas fall back to system-ui rather than throw.
  try {
    await Promise.all([
      document.fonts.load('700 96px "Bricolage Grotesque"'), // wordmark
      document.fonts.load('700 48px "Bricolage Grotesque"'), // hero line
      document.fonts.load('500 40px Inter'), // demand framing
      document.fonts.load('500 44px Inter'), // concession line
      document.fonts.load('500 36px Inter'), // meta line
      document.fonts.load('500 32px Inter'), // footer
    ]);
  } catch {
    /* non-fatal — canvas falls back to system-ui */
  }

  // ── Background + reserved-accent frame ──
  x.fillStyle = CREAM;
  x.fillRect(0, 0, SIZE, SIZE);
  x.strokeStyle = accent; // gold on win, crimson on loss — the reserved key.
  x.lineWidth = BORDER_W;
  x.strokeRect(BORDER, BORDER, SIZE - BORDER * 2, SIZE - BORDER * 2);

  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';

  // ── Two-pass: measure each wrapped block, then center the stack vertically ──
  // Quotation marks frame the hero/concession lines (yapword's roast convention).
  const heroText = `“${data.heroLine}”`;
  const concessionText = data.concessionLine ? `“${data.concessionLine}”` : '';
  const turnWord = data.turnsUsed === 1 ? 'turn' : 'turns';
  const streakBit = data.winStreak > 0 ? ` · 🔥 ${data.winStreak}-day streak` : '';
  const metaLine = won
    ? `Favor won in ${data.turnsUsed} ${turnWord} · ⚔️ ${data.tierLabel}${streakBit}`
    : `Dismissed · ⚔️ ${data.tierLabel}${streakBit}`;

  // Center the content stack within the padded card box.
  const boxTop = PAD_TOP;
  const boxBottom = SIZE - PAD_BOTTOM;
  const boxH = boxBottom - boxTop; // 920 (D-01).

  // ── FIT-TO-CARD uniform downscale (never clip — keep the meta line + footer URL) ──
  // Every type size, line-height, fixed band, inter-section gap, AND baseline-advance
  // offset is multiplied by a single `scale`. WRAP_MAX_W stays FIXED: at a smaller font
  // the same 880px wrap re-flows to ≤ the same line count, so the scaled stack is
  // smaller-or-equal — re-measuring at the scaled sizes gives the true scaled contentH.
  // base sizes (scale = 1) are the UI-SPEC values. `fz` scales any one of them.
  const fz = (n: number, scale: number) => n * scale;

  // Measure the whole stack at a given scale. The wrapped blocks (framing/hero/
  // concession) are re-measured at the scaled font sizes against the FIXED WRAP_MAX_W.
  // `x` is passed in (TS control-flow narrowing of the null-guard above doesn't cross
  // the closure boundary; a typed parameter keeps it non-null without a `!` assertion).
  function measure(scale: number, x: CanvasRenderingContext2D) {
    // Fixed-height single-line bands.
    const wordmarkH = fz(96, scale);
    const metaH = fz(36, scale);
    const footerH = fz(32, scale);
    // Section line-heights (the canvas vertical rhythm — measured-section, not a grid).
    const framingLH = fz(50, scale);
    const heroLH = fz(58, scale);
    const concessionLH = fz(56, scale);
    // Inter-section gaps (canvas px — generous breathing room, not the 4-grid).
    const gapAfterWordmark = fz(64, scale);
    const gapAfterFraming = fz(56, scale);
    const gapAfterHero = fz(56, scale);
    const gapAfterConcession = won && concessionText ? fz(56, scale) : 0;
    const gapBeforeFooter = fz(56, scale);
    // Wrapped-block heights — re-measured at the SCALED font sizes (WRAP_MAX_W fixed).
    x.font = `500 ${fz(40, scale)}px ${FAMILY_BODY}`;
    const framingH = measureWrappedHeight(x, data.demandScene, WRAP_MAX_W, framingLH);
    x.font = `700 ${fz(48, scale)}px ${FAMILY_DISPLAY}`;
    const heroH = measureWrappedHeight(x, heroText, WRAP_MAX_W, heroLH);
    let concessionH = 0;
    if (won && concessionText) {
      x.font = `500 ${fz(44, scale)}px ${FAMILY_BODY}`;
      concessionH = measureWrappedHeight(x, concessionText, WRAP_MAX_W, concessionLH);
    }
    const contentH =
      wordmarkH +
      gapAfterWordmark +
      framingH +
      gapAfterFraming +
      heroH +
      gapAfterHero +
      concessionH +
      gapAfterConcession +
      metaH +
      gapBeforeFooter +
      footerH;
    return {
      scale,
      contentH,
      wordmarkH,
      metaH,
      footerH,
      framingLH,
      heroLH,
      concessionLH,
      framingH,
      heroH,
      concessionH,
      gapAfterWordmark,
      gapAfterFraming,
      gapAfterHero,
      gapAfterConcession,
      gapBeforeFooter,
    };
  }

  // Measure at scale 1; if the natural stack overflows the box, re-measure at the
  // downscale that makes it fit (smaller fonts re-wrap, so the second measure is exact).
  let m = measure(1, x);
  if (m.contentH > boxH) {
    m = measure(boxH / m.contentH, x);
  }

  // Center the (now guaranteed-to-fit) stack vertically within the padded box.
  let y = boxTop + Math.max(0, (boxH - m.contentH) / 2);

  // ── Wordmark "Yapoleon's Court" (Bricolage 700, navy) ──
  x.fillStyle = NAVY;
  x.font = `700 ${fz(96, m.scale)}px ${FAMILY_DISPLAY}`;
  y += m.wordmarkH; // advance to baseline
  x.fillText("Yapoleon's Court", SIZE / 2, y);
  y += m.gapAfterWordmark;

  // ── Demand framing — the setup (Inter 500, warm ink) ──
  x.fillStyle = INK;
  x.font = `500 ${fz(40, m.scale)}px ${FAMILY_BODY}`;
  wrapText(x, data.demandScene, SIZE / 2, y + fz(40, m.scale), WRAP_MAX_W, m.framingLH);
  y += m.framingH + m.gapAfterFraming;

  // ── Hero line — the largest emotional beat (Bricolage 700, navy) ──
  // WIN: the player's winning reply (brag). LOSS: the savage dismissal line.
  x.fillStyle = NAVY;
  x.font = `700 ${fz(48, m.scale)}px ${FAMILY_DISPLAY}`;
  wrapText(x, heroText, SIZE / 2, y + fz(48, m.scale), WRAP_MAX_W, m.heroLH);
  y += m.heroH + m.gapAfterHero;

  // ── Concession line — WIN only (Inter 500, accent=gold) ──
  if (won && concessionText) {
    x.fillStyle = accent; // gold — the trophy beat. Never drawn on a loss card.
    x.font = `500 ${fz(44, m.scale)}px ${FAMILY_BODY}`;
    wrapText(x, concessionText, SIZE / 2, y + fz(44, m.scale), WRAP_MAX_W, m.concessionLH);
    y += m.concessionH + m.gapAfterConcession;
  }

  // ── Meta line (Inter 500, navy) ──
  // Win/loss is carried by TEXT here (a11y), never color alone:
  //   WIN:  "Favor won in N · Fair Fight · 🔥 N-day streak"
  //   LOSS: "Dismissed · Fair Fight" (+ streak if the player still holds a run)
  x.fillStyle = NAVY;
  x.font = `500 ${fz(36, m.scale)}px ${FAMILY_BODY}`;
  y += m.metaH; // advance to baseline
  x.fillText(metaLine, SIZE / 2, y);
  y += m.gapBeforeFooter;

  // ── Footer URL (Inter 500, ink) ──
  x.fillStyle = INK;
  x.font = `500 ${fz(32, m.scale)}px ${FAMILY_BODY}`;
  y += m.footerH;
  x.fillText('court.yapoleon.com', SIZE / 2, y);

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
    try {
      await navigator.share({ title: parts.title, text: parts.text, files: [file] });
      return;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return; // user-cancel = silent no-op
      // Any other share failure falls through to the download fallback below.
    }
  }

  // Desktop / no-canShare fallback: download the blob.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Card saved!');
}
