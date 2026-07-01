// Standalone judge client — no React dependency. Adapted from the fork source's
// gemini-client: KEEP the analytics bridge (trackEvent), API_BASE resolution, and
// the retry/backoff/abort loop; ADAPT the call to POST /api/court-judge with the
// judge body { scene, reply, axisWeights } and PARSE the structured JudgeResult
// ({ axisScores, favorDelta, dominantAxis, reaction }) instead of reading { text }.
//
// The judge response is NOT free text — a parse/network failure surfaces as a
// thrown JudgeError so the RoundScreen degrades to the error state with NO turn
// consumed (UI-SPEC "Try Again"), never a broken meter (T-01-10).

declare function gtag(...args: unknown[]): void;
import { Capacitor, registerPlugin } from '@capacitor/core';
import { API_BASE } from './config';
import { getToken } from './court-identity';
import type { Axis, JudgeResult } from './judge';
import type { DemandRecord } from './demands';
import posthog from 'posthog-js';

// ── Analytics bridge (forked) ───────────────────────────────────────

type AnalyticsParam = string | number | boolean | null | undefined;
type NativeAnalyticsPlugin = {
  logEvent(options: { name: string; params?: Record<string, AnalyticsParam> }): Promise<{ logged?: boolean; reason?: string }>;
  isConfigured(): Promise<{ configured: boolean }>;
};

export const NativeAnalytics = registerPlugin<NativeAnalyticsPlugin>('CourtAnalytics');

export const trackEvent = (name: string, params: Record<string, unknown> = {}) => {
  const safeParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => (
      typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
      || value === null
      || value === undefined
    )),
  ) as Record<string, AnalyticsParam>;

  if (Capacitor.isNativePlatform()) {
    NativeAnalytics.logEvent({
      name,
      params: { app_platform: Capacitor.getPlatform(), ...safeParams },
    }).catch(() => {});
    try {
      if (typeof posthog !== 'undefined' && typeof posthog.capture === 'function') {
        posthog.capture(name, { app_platform: Capacitor.getPlatform(), ...safeParams });
      }
    } catch { /* PostHog send failure is non-critical */ }
    return;
  }

  if (typeof gtag === 'function') {
    gtag('event', name, { app_platform: 'web', ...safeParams });
  }
  try {
    if (typeof posthog !== 'undefined' && typeof posthog.capture === 'function') {
      posthog.capture(name, { app_platform: 'web', ...safeParams });
    }
  } catch { /* PostHog send failure is non-critical */ }
};

// ── Judge call ──────────────────────────────────────────────────────

export class JudgeError extends Error {
  status?: number;
  code?: string;
  // SAFE-02: a red-line category when `code === 'moderation_flagged'` (else undefined).
  // Category ONLY (e.g. 'slur_hate' | 'threat' | 'sexual_minor') — never the input text.
  category?: string | null;
  constructor(message: string, status?: number, code?: string, category?: string | null) {
    super(message);
    this.name = 'JudgeError';
    this.status = status;
    this.code = code;
    this.category = category;
  }
}

// SAFE-02 (Plan 04-02): the server's distinct moderation response code. On a red-line
// the judge returns a 200 whose body is `{ code: MODERATION_FLAGGED_CODE, category }`
// (NOT a JudgeResult). judgeReply intercepts it BEFORE parseJudgeResult and surfaces a
// JudgeError carrying this code + category, so RoundScreen can render the in-voice
// brush-off (turn NOT consumed) instead of a generic parse error. The turn-not-consumed
// contract is the caller's (RoundScreen.submitTurn) — this module only distinguishes the
// signal.
export const MODERATION_FLAGGED_CODE = 'moderation_flagged';

// Type guard the client uses to branch on the moderation signal without string-matching
// in multiple places. True only for a JudgeError carrying the moderation code.
export function isModerationFlag(err: unknown): err is JudgeError {
  return err instanceof JudgeError && err.code === MODERATION_FLAGGED_CODE;
}

export type JudgeFetchOptions = {
  signal?: AbortSignal;
  maxAttempts?: number;
  timeoutMs?: number;
};

const AXES: Axis[] = ['wit', 'specificity', 'audacity', 'economy', 'flattery'];

// Defensive client-side parse of the server's JudgeResult. The server already
// validates + derives favorDelta; this guards against an unexpected payload shape
// so a bad response throws (→ error state) rather than corrupting the meter.
function parseJudgeResult(data: unknown): JudgeResult {
  if (!data || typeof data !== 'object') {
    throw new JudgeError('Judge returned no result');
  }
  const d = data as Record<string, unknown>;
  const scoresRaw = d.axisScores;
  if (!scoresRaw || typeof scoresRaw !== 'object') {
    throw new JudgeError('Judge result missing axisScores');
  }
  const scores = scoresRaw as Record<string, unknown>;
  const axisScores = {} as Record<Axis, number>;
  for (const ax of AXES) {
    const v = Number(scores[ax]);
    axisScores[ax] = Number.isFinite(v) ? v : 0;
  }
  const favorDelta = Number(d.favorDelta);
  if (!Number.isFinite(favorDelta)) {
    throw new JudgeError('Judge result missing favorDelta');
  }
  const dominantAxis = (AXES as string[]).includes(d.dominantAxis as string)
    ? (d.dominantAxis as Axis)
    : AXES[0];
  const reaction = typeof d.reaction === 'string' ? d.reaction : '';
  return { axisScores, favorDelta, dominantAxis, reaction };
}

/**
 * Submit one turn to the judge: POST the demand's scene + axisWeights + the
 * player's reply to /api/court-judge and return the parsed JudgeResult. Retries
 * transient (5xx / network) failures with backoff; throws JudgeError on a
 * deterministic 4xx or after the attempts are exhausted so the caller can render
 * the error state without consuming the turn.
 */
export const judgeReply = async (
  demand: DemandRecord,
  reply: string,
  priorReplies: string[] = [],
  options?: JudgeFetchOptions,
): Promise<JudgeResult> => {
  const requestBody = {
    scene: demand.scene,
    reply,
    axisWeights: demand.axisWeights,
    rubric_version: demand.rubricVersion,
    // JUDGE-05: the player's OWN earlier replies this round (server folds the deterministic
    // near-dup pre-check into the SAME judge call — voice-only, 0 extra model calls).
    priorReplies,
  };

  let delay = 1000;
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  let lastError: JudgeError = new JudgeError('Judge unavailable');

  for (let i = 0; i < maxAttempts; i++) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let timeoutSignal: AbortController | null = null;
    let relayAbort: (() => void) | null = null;
    try {
      if (options?.signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
      if (options?.timeoutMs) {
        timeoutSignal = new AbortController();
        timeoutId = setTimeout(() => timeoutSignal?.abort(), options.timeoutMs);
      }
      if (options?.signal && timeoutSignal) {
        const onAbort = () => timeoutSignal?.abort();
        options.signal.addEventListener('abort', onAbort, { once: true });
        relayAbort = () => options.signal?.removeEventListener('abort', onAbort);
      }
      const signal = timeoutSignal?.signal ?? options?.signal;

      const token = getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/api/court-judge`, {
        method: 'POST',
        headers,
        ...(signal ? { signal } : {}),
        body: JSON.stringify(requestBody),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (data as Record<string, unknown>).code as string | undefined;
        lastError = new JudgeError(
          (data as Record<string, unknown>).error as string || `Judge error ${res.status}`,
          res.status,
          code,
        );
        // 4xx are deterministic — retrying won't help; surface immediately.
        if (res.status >= 400 && res.status < 500) {
          trackEvent('court_judge_error', { status: res.status, code: code ?? 'none' });
          throw lastError;
        }
        // 5xx — retry with backoff.
        throw new Error(`Judge ${res.status}`);
      }

      // SAFE-02 BRIDGE: a red-line submission comes back as a 200 whose body is NOT a
      // JudgeResult but `{ code: 'moderation_flagged', category }`. WITHOUT this
      // interception the 200 would fall through to parseJudgeResult and surface as an
      // indistinguishable GENERIC, code-less JudgeError ("Judge result missing
      // axisScores"). Intercept it FIRST and surface a moderation-tagged JudgeError
      // (carrying the code + category) so the caller can render the in-voice brush-off
      // instead of the generic error state. This is a deterministic outcome — do NOT
      // retry it (a red line will flag again) — so it is thrown and re-thrown past the
      // backoff loop by the isModerationFlag guard in catch.
      const moderationCode = (data as Record<string, unknown>).code;
      if (moderationCode === MODERATION_FLAGGED_CODE) {
        const category = (data as Record<string, unknown>).category;
        trackEvent('court_moderation_flagged', {
          category: typeof category === 'string' ? category : 'red_line',
        });
        throw new JudgeError(
          'moderation flagged',
          res.status,
          MODERATION_FLAGGED_CODE,
          typeof category === 'string' ? category : null,
        );
      }

      const result = parseJudgeResult(data);
      trackEvent('court_judge_ok', { dominant_axis: result.dominantAxis, delta: result.favorDelta });
      return result;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' && options?.signal?.aborted) {
        throw err;
      }
      // SAFE-02: a moderation flag is a DETERMINISTIC 200 outcome — surface it
      // immediately (do NOT retry; a red line re-flags). It carries status 200 so it
      // would otherwise slip past the 4xx guard below into the backoff loop.
      if (isModerationFlag(err)) {
        throw err;
      }
      if (err instanceof JudgeError && err.status && err.status >= 400 && err.status < 500) {
        throw err; // deterministic client error — do not retry
      }
      if (!(err instanceof JudgeError)) {
        lastError = new JudgeError('Could not reach the judge', undefined, 'network_error');
      }
      if (i === maxAttempts - 1) {
        trackEvent('court_judge_error', { status: lastError.status ?? -1, code: lastError.code ?? 'network_error' });
        throw lastError;
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 4000);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      relayAbort?.();
    }
  }
  throw lastError;
};
