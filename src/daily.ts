// ─────────────────────────────────────────────
//  Daily round: deterministic day-of selection
// ─────────────────────────────────────────────
// Daily rollover is anchored to midnight in New York (America/New_York), so
// every player worldwide flips to the new demand at the same instant. DST is
// handled by Intl (no fixed offset). Epoch: 2026-01-01 in NY = Court day #1.
//
// Lifted verbatim from the fork source's deterministic-select math. The
// per-difficulty seed-offset variant is intentionally DROPPED — launch is
// Fair Fight only, with no per-difficulty offset (RESEARCH §A/§E, CONT-02).
const EPOCH_UTC = Date.UTC(2026, 0, 1);
const DAILY_TZ = 'America/New_York';

// The calendar date in the rollover timezone for a given instant.
const zonedDateParts = (d: Date): { year: number; month: number; day: number } => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
};

export const getDayNumber = (d: Date = new Date()): number => {
  const { year, month, day } = zonedDateParts(d);
  const today = Date.UTC(year, month - 1, day);
  return Math.floor((today - EPOCH_UTC) / 86400000) + 1;
};

// Stable shuffle so consecutive days don't walk the demand list in order.
// Module-private here; re-exported for demands.ts (selectDailyDemand, Plan 01-04).
export const scramble = (n: number): number => {
  let h = (n + 1) * 2654435761;
  h = (h ^ (h >>> 15)) >>> 0;
  return h;
};

// Wall-clock time in the rollover timezone for a given instant.
const zonedTimeParts = (d: Date): { hour: number; minute: number; second: number } => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DAILY_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { hour: pick('hour') % 24, minute: pick('minute'), second: pick('second') };
};

// Milliseconds until the next midnight in the rollover timezone — a single
// global instant, so the value is identical for every player regardless of
// their own timezone (the countdown is a duration, not a local clock). On the
// two DST-transition days a "day" isn't exactly 24h so the display can be off
// by up to an hour, but the actual rollover is driven by getDayNumber()
// changing, so the demand still flips at the correct moment.
export const msUntilNextDay = (now: Date = new Date()): number => {
  const { hour, minute, second } = zonedTimeParts(now);
  const elapsedMs = ((hour * 60 + minute) * 60 + second) * 1000 + (now.getTime() % 1000);
  return 86400000 - elapsedMs;
};
