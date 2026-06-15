// Server-authoritative day-of-game helper. Plain-JS mirror of src/daily.ts's
// getDayNumber so the serverless functions (.js, run by Vercel's Node runtime,
// which does NOT transpile TS) never have to import the .ts client module.
//
// The day is computed server-side from the request instant — the client cannot
// spoof it. Rollover is anchored to midnight America/New_York (DST-safe via Intl),
// epoch 2026-01-01 in NY = Court day #1 — IDENTICAL math to src/daily.ts.

const EPOCH_UTC = Date.UTC(2026, 0, 1);
const DAILY_TZ = 'America/New_York';

function zonedDateParts(d) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const pick = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

export function getDayNumber(d = new Date()) {
  const { year, month, day } = zonedDateParts(d);
  const today = Date.UTC(year, month - 1, day);
  return Math.floor((today - EPOCH_UTC) / 86400000) + 1;
}
