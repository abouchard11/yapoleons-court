// Client dossier/greeting layer (MEM-01/03). Fetches the pre-round greeting and
// defensively parses it into a GreetingPayload. The defining rule: this NEVER throws
// into the round — a non-200, a network error, or a malformed shape RESOLVES to `null`
// (no greeting beat), so the round always opens exactly as it does today (Pitfall 6).
//
// Hallucination guard (client half): a callback survives parsing ONLY when it carries
// BOTH a non-empty `fragment` and a non-empty `turnId`, and a `coldstart` greeting can
// NEVER carry one — the UI has no path to synthesize a memory from any other field.

import { API_BASE } from './config';
import { getToken } from './court-identity';
import { trackEvent } from './gemini-client';

// ── Greeting payload (per round open) — verbatim from 03-UI-SPEC Data Contract. ──
// The callback is OPTIONAL and only present when grounded (verbatim-quote-backed); its
// absence is what triggers the cold-start / standing-only rendering.
export interface GreetingPayload {
  variant: 'returning' | 'coldstart' | 'winback';
  eyebrow?: string;        // rank/streak texture tag, e.g. "3-DAY STREAK" — navy Label, never gold
  line: string;            // the in-voice greeting (Display) — ALWAYS present
  callback?: {             // PRESENT ONLY when grounded (a real turn_id-backed quote)
    fragment: string;      // the remembered specific (the player's own verbatim line)
    turnId: string;        // provenance — the UI may render but NEVER invents this
  };
}

// ── Court-standing view — verbatim from 03-UI-SPEC Data Contract. ──
// Forward-compatible type for the v2 CourtStandingScreen (DEFERRED, CONTEXT D-08). Phase 3
// surfaces the dossier through the greeting, not this screen; the type is kept so the v2
// surface has a stable contract and the highlight/grounding shape is documented in one place.
export interface DossierView {
  rankName: string;                 // texture word, navy — never a number/meter
  trajectory: 'rising' | 'steady' | 'cooling';
  streak: number;                   // shown as "🔥 N-day streak" text, 0 ⇒ hidden
  highlights: Array<{               // 1–3 EXTRACTIVE; each REQUIRES a quote + turnId
    quote: string;
    context: string;
    turnId: string;
  }>;
  grudges: Array<{ description: string; active: boolean }>;
  titles: Array<{ name: string; earned: boolean }>;
  history: Array<{ day: number; outcome: 'won' | 'lost'; line?: string }>;
}

// Defensive parse: returns a clean GreetingPayload or null. The callback is admitted
// ONLY with both fragment + turnId, and is stripped for coldstart (the contract).
function parseGreeting(data: unknown): GreetingPayload | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const variant = d.variant;
  if (variant !== 'returning' && variant !== 'coldstart' && variant !== 'winback') return null;
  const line = typeof d.line === 'string' ? d.line.trim() : '';
  if (!line) return null;
  const eyebrow = typeof d.eyebrow === 'string' && d.eyebrow.trim() ? d.eyebrow : undefined;

  let callback: GreetingPayload['callback'];
  const cb = d.callback;
  if (variant !== 'coldstart' && cb && typeof cb === 'object') {
    const c = cb as Record<string, unknown>;
    const fragment = typeof c.fragment === 'string' ? c.fragment.trim() : '';
    const turnId = typeof c.turnId === 'string' ? c.turnId.trim() : '';
    // Both required (the hallucination guard) — a partial callback is dropped, not rendered.
    if (fragment && turnId) callback = { fragment, turnId };
  }

  return { variant, line, eyebrow, callback };
}

/**
 * Fetch the pre-round greeting. Attaches the bearer token, POSTs /api/court-greeting,
 * and parses defensively. RESOLVES to null (never throws) on a non-200, a network error,
 * or a bad shape — the caller treats null as "no greeting beat" and opens the round.
 */
export async function fetchGreeting(): Promise<GreetingPayload | null> {
  try {
    const token = getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/api/court-greeting`, { method: 'POST', headers });
    if (!res.ok) return null; // any non-200 ⇒ silent skip (the greeting is additive)

    const data = await res.json().catch(() => null);
    const greeting = parseGreeting(data);
    if (!greeting) return null;

    // Activation telemetry: greeting shown + (when grounded) the time-to-first-landed-callback signal.
    trackEvent('court_greeting_shown', { variant: greeting.variant });
    if (greeting.callback) trackEvent('court_callback_landed', {});

    return greeting;
  } catch {
    return null; // network/parse failure ⇒ silent skip, never throw into the round
  }
}
