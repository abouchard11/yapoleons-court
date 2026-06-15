import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const EVENTS_TABLE = 'yapoleon_observability_events';
const MAX_SAMPLE_LENGTH = 280;

function getSupabaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getRuntimeMeta() {
  return {
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || 'unknown',
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
    vercelEnv: process.env.VERCEL_ENV || process.env.VERCEL_TARGET_ENV || 'unknown',
  };
}

export function buildRequestHash(prompt, systemInstruction = '') {
  return createHash('sha256')
    .update(String(systemInstruction || ''), 'utf8')
    .update('\n::\n', 'utf8')
    .update(String(prompt || ''), 'utf8')
    .digest('hex')
    .slice(0, 24);
}

export function normalizeHumorSample(text) {
  if (typeof text !== 'string') return null;
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.slice(0, MAX_SAMPLE_LENGTH);
}

// Map a Gemini response's usageMetadata to the observability token columns.
// Null-safe: a safety-blocked / error response carries no usageMetadata, and any
// individual field can be absent (non-thinking responses omit thoughtsTokenCount).
// Non-numeric or negative values coerce to null rather than poisoning the integer columns.
export function normalizeTokenUsage(usage) {
  const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  if (!usage || typeof usage !== 'object') {
    return { promptTokens: null, outputTokens: null, thoughtsTokens: null, totalTokens: null };
  }
  return {
    promptTokens: num(usage.promptTokenCount),
    outputTokens: num(usage.candidatesTokenCount),
    thoughtsTokens: num(usage.thoughtsTokenCount),
    totalTokens: num(usage.totalTokenCount),
  };
}

export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const nums = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const rank = Math.ceil((p / 100) * nums.length) - 1;
  const idx = Math.max(0, Math.min(nums.length - 1, rank));
  return nums[idx];
}

export function buildHumorQualitySamples(events, maxSamples = 12) {
  const source = events
    .filter((event) =>
      event.mode === 'persona' &&
      !event.fallback &&
      typeof event.humor_sample === 'string' &&
      event.humor_sample.trim().length > 0
    )
    .slice(0, maxSamples)
    .map((event) => ({
      created_at: event.created_at,
      model: event.selected_model || event.model_attempted || 'unknown',
      latency_ms: event.latency_ms,
      request_hash: event.request_hash,
      sample: event.humor_sample,
    }));
  return source;
}

function normalizeSignature(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildRepetitionReport(events, maxItems = 6) {
  const counts = new Map();
  for (const event of events) {
    if (event.mode !== 'persona' || event.fallback || typeof event.humor_sample !== 'string') continue;
    const signature = normalizeSignature(event.humor_sample);
    if (!signature) continue;
    const current = counts.get(signature);
    if (current) {
      current.count += 1;
    } else {
      counts.set(signature, { count: 1, sample: event.humor_sample });
    }
  }

  return [...counts.values()]
    .filter((item) => item.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, maxItems)
    .map((item) => ({ count: item.count, sample: item.sample }));
}

const NEAR_DUP_THRESHOLD = 0.55;
const NEAR_DUP_ADJACENCY_WINDOW = 3;
const NEAR_DUP_MAX_GAP_MS = 30 * 60 * 1000;
const NEAR_DUP_MAX_ITEMS = 6;

function trigramSet(text) {
  const normalized = normalizeSignature(String(text ?? ''));
  if (!normalized) return new Set();
  if (normalized.length <= 3) return new Set([normalized]);
  const grams = new Set();
  for (let i = 0; i <= normalized.length - 3; i += 1) {
    grams.add(normalized.slice(i, i + 3));
  }
  return grams;
}

function jaccardFromSets(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function trigramJaccardSimilarity(a, b) {
  return jaccardFromSets(trigramSet(a), trigramSet(b));
}

// Near-duplicate detector: catches Yapoleon telling the same joke twice in a
// session even when the wording drifts, which exact-signature matching
// (buildRepetitionReport) misses. Pairs are only compared within a short
// time window so unrelated games on the same day don't cross-flag.
export function buildNearDuplicateReport(events, options = {}) {
  const {
    threshold = NEAR_DUP_THRESHOLD,
    adjacencyWindow = NEAR_DUP_ADJACENCY_WINDOW,
    maxGapMs = NEAR_DUP_MAX_GAP_MS,
    maxItems = NEAR_DUP_MAX_ITEMS,
  } = options;

  const samples = events
    .filter((event) =>
      event.mode === 'persona' &&
      !event.fallback &&
      typeof event.humor_sample === 'string' &&
      event.humor_sample.trim().length > 0
    )
    .map((event) => ({
      createdAt: event.created_at,
      ts: Date.parse(event.created_at),
      requestHash: event.request_hash || null,
      sample: event.humor_sample,
      grams: trigramSet(event.humor_sample),
    }))
    .filter((sample) => Number.isFinite(sample.ts))
    .sort((a, b) => a.ts - b.ts);

  const pairs = [];
  for (let i = 1; i < samples.length; i += 1) {
    for (let j = Math.max(0, i - adjacencyWindow); j < i; j += 1) {
      const earlier = samples[j];
      const later = samples[i];
      const gapMs = later.ts - earlier.ts;
      if (gapMs > maxGapMs) continue;
      const similarity = jaccardFromSets(earlier.grams, later.grams);
      if (similarity < threshold) continue;
      pairs.push({
        similarity: Number(similarity.toFixed(3)),
        gapSeconds: Math.round(gapMs / 1000),
        day: String(earlier.createdAt).slice(0, 10),
        sameRequestHash: Boolean(earlier.requestHash && earlier.requestHash === later.requestHash),
        first: { created_at: earlier.createdAt, request_hash: earlier.requestHash, sample: earlier.sample },
        second: { created_at: later.createdAt, request_hash: later.requestHash, sample: later.sample },
      });
    }
  }

  pairs.sort((a, b) => b.similarity - a.similarity || a.gapSeconds - b.gapSeconds);

  return {
    threshold,
    flaggedPairCount: pairs.length,
    daysAffected: new Set(pairs.map((pair) => pair.day)).size,
    worstPairs: pairs.slice(0, maxItems),
  };
}

// ── In-game repetition detector (quality regression alerts, 2026-06-10) ──
// The 2026-06-10 "dead S" bug: Yapoleon delivered the same joke three times in
// one game, every Gemini call returned 200, and nothing alerted the owner —
// fallback failures had full alerting while quality failures had none. Since
// PR #63 every persona prompt carries the player's own prior lines in an
// [ALREADY SAID THIS GAME] block, so the server can compare each new line
// against exactly what THIS player already heard this game: per-player
// grouping with zero schema changes and no cross-player false positives.

const PRIOR_LINES_HEADER = '[ALREADY SAID THIS GAME]';

const QUALITY_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // mirror gemini.js per-kind throttle
let lastQualityAlertAt = 0;

// Common English + game-generic vocabulary that carries no comedic identity.
// Two lines sharing only these words are NOT the same joke.
const REPETITION_STOPWORDS = new Set((
  'a an the and or but so yet nor of to in on at by for from with into onto over under ' +
  'through out off up down again still only just even not no nor never very too also ' +
  'is are was were be been being am do does did done have has had having will would ' +
  'shall should can could may might must it its it’s this that these those there here ' +
  'i me my mine you your yours yourself he him his she her hers we us our ours they ' +
  'them their theirs who whom whose which what when where why how than then as if ' +
  'because while after before between against your you’re ' +
  'yapoleon emperor word words letter letters guess guesses guessed guessing board ' +
  'tile tiles navy navies gold golds slate graphite daily game player round puzzle ' +
  'one two three four five six seven eight nine ten first second third fourth fifth sixth'
).split(/\s+/));

function normalizeTokens(text) {
  return normalizeSignature(String(text || '')).split(' ').filter(Boolean);
}

/**
 * Extract the comedic fingerprint of a line: content words plus explicit
 * letter callouts. A bare uppercase single letter (except ambiguous A/I) or a
 * quoted single letter is a letter reference ("the dead S", "golden 'A'") —
 * highly salient in a word game. Articles and pronouns never count.
 */
export function salientTokens(text) {
  const raw = String(text || '');
  const tokens = new Set(
    normalizeTokens(raw).filter((t) => t.length > 1 && !REPETITION_STOPWORDS.has(t)),
  );
  const letterPattern = /(?:['"‘’“”]([A-Za-z])['"‘’“”]|(?<![A-Za-z])([B-HJ-Z])(?![A-Za-z]))/g;
  for (const match of raw.matchAll(letterPattern)) {
    const letter = (match[1] || match[2] || '').toLowerCase();
    if (letter) tokens.add(`letter:${letter}`);
  }
  return tokens;
}

function tokenSalienceWeight(token) {
  return token.startsWith('letter:') ? 6 : token.length;
}

function longestCommonRun(tokensA, tokensB) {
  let best = 0;
  for (let i = 0; i < tokensA.length; i++) {
    for (let j = 0; j < tokensB.length; j++) {
      let k = 0;
      while (i + k < tokensA.length && j + k < tokensB.length && tokensA[i + k] === tokensB[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

/**
 * Score how much `lineA` repeats the joke in `lineB`. Returns a similarity
 * report; `repeated` is true when the lines share the same comedic core.
 * Thresholds are pinned by tests using the real 2026-06-10 repeated lines
 * (must flag) and the verified-distinct fixed-game lines (must pass).
 */
export function scoreLineSimilarity(lineA, lineB) {
  const salientA = salientTokens(lineA);
  const salientB = salientTokens(lineB);
  let sharedWeight = 0;
  let sharedCount = 0;
  for (const token of salientA) {
    if (salientB.has(token)) {
      sharedWeight += tokenSalienceWeight(token);
      sharedCount += 1;
    }
  }
  const weightOf = (set) => [...set].reduce((sum, t) => sum + tokenSalienceWeight(t), 0);
  const minWeight = Math.min(weightOf(salientA), weightOf(salientB));
  const weightedOverlap = minWeight > 0 ? sharedWeight / minWeight : 0;
  const unionCount = salientA.size + salientB.size - sharedCount;
  const salientJaccard = unionCount > 0 ? sharedCount / unionCount : 0;
  const commonRun = longestCommonRun(normalizeTokens(lineA), normalizeTokens(lineB));

  // Two shared comedic anchors (e.g. "dragged" + the letter S) at moderate
  // overlap = same joke. A single shared anchor needs much stronger overlap.
  // Thresholds are pinned by fixtures from the real 2026-06-10 incident.
  const repeated =
    commonRun >= 5 ||
    (sharedCount >= 2 && weightedOverlap >= 0.25) ||
    weightedOverlap >= 0.45 ||
    salientJaccard >= 0.4;
  const score = Number(Math.max(weightedOverlap, salientJaccard, commonRun >= 5 ? 1 : 0).toFixed(3));
  return { repeated, score, weightedOverlap, salientJaccard, sharedCount, commonRun };
}

/** Parse the prior-lines block PR #63 embeds in persona prompts. */
export function extractPriorLines(prompt) {
  if (typeof prompt !== 'string') return [];
  const idx = prompt.lastIndexOf(PRIOR_LINES_HEADER);
  if (idx === -1) return [];
  const lines = [];
  for (const raw of prompt.slice(idx + PRIOR_LINES_HEADER.length).split('\n')) {
    const match = raw.match(/^- "(.+)"$/);
    if (match) lines.push(match[1]);
    else if (lines.length > 0) break; // directive sentence ends the block
  }
  return lines;
}

/**
 * Compare a freshly delivered persona line against the player's prior lines
 * from the same game. Returns the worst (most similar) repeat, or null.
 */
export function detectRepetition(newLine, priorLines) {
  if (!newLine || !Array.isArray(priorLines) || priorLines.length === 0) return null;
  let worst = null;
  for (const prior of priorLines) {
    const result = scoreLineSimilarity(newLine, prior);
    if (result.repeated && (!worst || result.score > worst.score)) {
      worst = { ...result, matchedLine: prior };
    }
  }
  return worst;
}

async function sendQualityRepetitionAlert({ newLine, matchedLine, score, requestHash, deploymentId }) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL || '';
  if (!webhookUrl) return { ok: false, reason: 'missing_alert_webhook' };
  const now = Date.now();
  if (now - lastQualityAlertAt < QUALITY_ALERT_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
  lastQualityAlertAt = now;
  try {
    const u = new URL(webhookUrl);
    u.searchParams.set('secret', process.env.ALERT_SECRET || '');
    u.searchParams.set('to', process.env.ALERT_TO || 'problem@yapoleonscourt.com');
    u.searchParams.set('subject', "[Yapoleon's Court] Yapoleon QUALITY regression — repeated joke in one game");
    u.searchParams.set(
      'text',
      `Yapoleon delivered a line too similar to one he already said THIS game.\n\n` +
        `New line: ${newLine}\n` +
        `Earlier line: ${matchedLine}\n` +
        `Similarity score: ${score}\n` +
        `Request Hash: ${requestHash || 'unknown'}\n` +
        `Deployment ID: ${deploymentId || 'unknown'}\n` +
        `Time: ${new Date().toISOString()}\n\n` +
        `Gemini is UP (this was a live 200 response) — this is a humor/prompt regression, ` +
        `not an outage. Every detection is also tagged quality_repetition in ` +
        `yapoleon_observability_events; the weekly digest totals them. Replay scenarios with ` +
        `npm run yapoleon:lab and check recent prompt-engine changes (src/prompts/yapoleon.ts).`,
    );
    await fetch(u.toString(), { method: 'GET' });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Test hook — never call from production code. */
export function __resetQualityAlertCooldownForTests() {
  lastQualityAlertAt = 0;
}

export function summarizeQualityWindow(events) {
  const total = events.length;
  const fallbackCount = events.filter((event) => event.fallback).length;
  const rate429Count = events.filter((event) => Number(event.status_code) === 429).length;
  const latencies = events.map((event) => Number(event.latency_ms)).filter((n) => Number.isFinite(n));

  const fallbackPct = total > 0 ? Number(((fallbackCount / total) * 100).toFixed(2)) : 0;
  const rate429Pct = total > 0 ? Number(((rate429Count / total) * 100).toFixed(2)) : 0;
  const p95LatencyMs = percentile(latencies, 95);

  return {
    totalRequests: total,
    fallbackCount,
    fallbackPct,
    status429Count: rate429Count,
    status429Pct: rate429Pct,
    p95LatencyMs,
    humorSamples: buildHumorQualitySamples(events),
    repeatedHumorLines: buildRepetitionReport(events),
    nearDuplicateHumor: buildNearDuplicateReport(events),
    inGameRepetitions: buildInGameRepetitionReport(events),
  };
}

/** Surface per-game repetition detections (tagged at record time) for the digest. */
export function buildInGameRepetitionReport(events, maxItems = 5) {
  const flagged = events.filter((event) => event.error_code === 'quality_repetition');
  return {
    count: flagged.length,
    samples: flagged.slice(0, maxItems).map((event) => ({
      created_at: event.created_at,
      request_hash: event.request_hash,
      sample: event.humor_sample,
      detail: event.error_detail || null,
    })),
  };
}

export async function recordYapoleonEvent(payload, timeoutMs = 250) {
  const sb = getSupabaseClient();
  if (!sb) return { ok: false, skipped: 'missing_supabase_env' };

  const row = {
    created_at: payload.createdAt || new Date().toISOString(),
    request_id: payload.requestId || null,
    request_hash: payload.requestHash || null,
    deployment_id: payload.deploymentId || null,
    commit_sha: payload.commitSha || null,
    vercel_env: payload.vercelEnv || null,
    mode: payload.mode || 'utility',
    requested_model: payload.requestedModel || null,
    model_attempted: payload.modelAttempted || null,
    selected_model: payload.selectedModel || null,
    status_code: Number(payload.statusCode || 0),
    fallback: Boolean(payload.fallback),
    is_rate_limited_429: Number(payload.statusCode) === 429,
    latency_ms: Number.isFinite(payload.latencyMs) ? Math.max(0, Math.round(payload.latencyMs)) : null,
    error_code: payload.errorCode || null,
    error_detail: payload.errorDetail || null,
    humor_sample: normalizeHumorSample(payload.humorSample),
    // Per-call Gemini token usage (migration 014): cost observability. Sourced from the
    // delivered Gemini response's usageMetadata; null when the response omits it.
    // thoughts_tokens is the thinking-model reasoning budget (gemini-3.5-flash), billed
    // separately and typically the bulk of output cost.
    ...(() => {
      const t = normalizeTokenUsage(payload.usage);
      return {
        prompt_tokens: t.promptTokens,
        output_tokens: t.outputTokens,
        thoughts_tokens: t.thoughtsTokens,
        total_tokens: t.totalTokens,
      };
    })(),
    // Upstream attempt count of the delivered call (1 = first try; >1 = retried after a
    // 9s timeout — confirms the latency-tail hypothesis). regenerated = the regen-once
    // guard spent an extra upstream call on this reaction.
    upstream_attempts: Number.isFinite(payload.upstreamAttempts) ? Math.max(0, Math.round(payload.upstreamAttempts)) : null,
    regenerated: Boolean(payload.regenerated),
  };

  // Quality repetition check: persona success + a prompt carrying prior lines.
  // Pure CPU before the insert; the owner alert is fire-and-forget so it can
  // never add latency to a gameplay response. The prompt is parsed in memory
  // only — never stored.
  if (row.mode === 'persona' && row.humor_sample && !row.error_code && typeof payload.prompt === 'string') {
    const detection = detectRepetition(row.humor_sample, extractPriorLines(payload.prompt));
    if (detection) {
      row.error_code = 'quality_repetition';
      row.error_detail = `repeats earlier line this game (score ${detection.score}): "${detection.matchedLine.slice(0, 160)}"`;
      void sendQualityRepetitionAlert({
        newLine: row.humor_sample,
        matchedLine: detection.matchedLine,
        score: detection.score,
        requestHash: row.request_hash,
        deploymentId: row.deployment_id,
      }).catch(() => {});
    }
  }

  const insertPromise = sb.from(EVENTS_TABLE).insert(row);
  const timeoutPromise = sleep(timeoutMs).then(() => ({ timeout: true }));
  const result = await Promise.race([insertPromise, timeoutPromise]);

  if (result && result.timeout) {
    return { ok: false, skipped: 'timeout' };
  }

  if (result?.error) {
    return { ok: false, skipped: 'insert_failed', detail: result.error.message };
  }

  return { ok: true };
}

export async function fetchYapoleonEventsSince(startIso, maxRows = 50000) {
  const sb = getSupabaseClient();
  if (!sb) return { events: [], warning: 'missing_supabase_env' };

  const { data, error } = await sb
    .from(EVENTS_TABLE)
    .select('created_at, request_id, request_hash, mode, status_code, fallback, is_rate_limited_429, latency_ms, model_attempted, selected_model, humor_sample, deployment_id, commit_sha, error_code, error_detail')
    .gte('created_at', startIso)
    .order('created_at', { ascending: false })
    .limit(maxRows);

  if (error) {
    return { events: [], warning: error.message };
  }

  return { events: data || [], warning: null };
}
