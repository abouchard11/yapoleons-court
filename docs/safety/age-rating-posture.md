# Yapoleon's Court — No-PII / COPPA-Safe Posture & Age-Rating Rationale (SAFE-03)

**Status:** Reference posture for App Store submission. The **final age rating is decided
at submission time**, not locked here (locked design line 179). This document records the
privacy posture and the 9+-vs-13+ reasoning that the App Store Connect questionnaire
answers will follow from.

**Requirement:** SAFE-03 — "Anonymous play collects no PII (COPPA-safe); age-rating posture
documented."

**Related:** This is the **privacy + rating** half of must-nail #4. The **output** half — the
all-ages "safe savagery" bound on what Yapoleon *says* — is enforced separately by **SAFE-01**
(Plan 04-01: a curated adversarial corpus run through the real judge, scanned every PR for
slurs/strong-profanity and person/protected-trait targeting). The **input** half — refusing
genuine red lines *before* the judge — is **SAFE-02** (Plan 04-02: `detectRedLines` in
`api/_sanitize.js`, gating `api/court-judge.js`). Together SAFE-01 + SAFE-02 + this posture are
what let the game ship as all-ages without neutering the cutting banter that IS the game.

---

## 1. No-PII / COPPA-Safe Posture

Yapoleon's Court collects **no personally identifiable information** and requires **no account,
email, sign-in, or age gate** to play. The posture is COPPA-safe *by construction* (there is no
PII to collect from anyone, of any age), not by a consent flow bolted on after the fact.

### 1.1 Anonymous, mint-on-first-launch identity

The only per-player credential is an **opaque, server-minted identifier**:

- `getPlayerId()` (`src/court-identity.ts`) returns the anonymous `player_id` — an opaque UUID
  with **no PII**, minted on first launch by `POST /api/court-anon` with **no PII in the request
  body** (anonymous by construction). It is paired with an opaque bearer `token`.
- There is **no sign-up, no contact/billing/entitlement state** (that state was deliberately
  removed when the identity module was forked from the source engine — see the `court-identity.ts`
  header).
- The `player_id` is the join key for the replay-lock tables and analytics, and it is **never
  joined to any name, email, device fingerprint, or other identifier.** This "never join PII to
  `player_id`" rule is a standing invariant.

Because a fresh anonymous id is minted locally with no PII, a child playing the game discloses
nothing personal — which is precisely why the game is COPPA-safe regardless of the player's age.

### 1.2 Category-only moderation logging (D-07)

The SAFE-02 input pre-filter (`detectRedLines`, Plan 04-02) logs the moderation **flag + a coarse
category ONLY** — **never the offending text**:

- `detectRedLines(text)` returns `{ flagged, category }` with **no text** in the return value.
- The moderation observability event in `api/court-judge.js` passes `prompt: null` and
  `errorDetail: "red-line category: <category>"` — the reply the player typed is **never
  persisted.** The category taxonomy is coarse (`slur_hate` | `threat` | `sexual_minor`) —
  enough to triage a false-positive rate, never enough to reconstruct the input.

This means even when a player crosses a red line, **nothing they typed is stored** — the strongest
possible no-PII stance at exactly the moment PII/COPPA liability would otherwise arise.

### 1.3 Analytics identify uses the opaque id, omits person properties

Product analytics (PostHog project 469777, D-11) identifies players by the **opaque `player_id`
only**:

- `posthog.identify(getPlayerId())` is called with the **person-properties argument OMITTED** —
  no PII is ever attached to the person profile. (See Plan 04-04 for the VAL-01 identify wiring;
  this posture is the constraint that wiring must honor.)
- Event properties carry the anonymous `player_id`; they carry **no name, email, or device PII**.
- GA4 (property 538728082) stays for **acquisition/traffic** only and likewise carries no PII
  tied to gameplay identity.

The opaque UUID is a valid analytics `distinct_id` precisely *because* it is opaque and PII-free —
which keeps D1/D7 retention and the round funnel working while staying COPPA-safe.

---

## 2. Age-Rating Rationale — 9+ vs 13+ (post-2025 Apple tiers)

### 2.1 The current Apple tiers (as of this writing)

Apple **overhauled** App Store age ratings in **July 2025**. The current tiers are:

> **4+ · 9+ · 13+ · 16+ · 18+**

**The 12+ tier was REMOVED in July 2025** and effectively replaced by 13+ (the old 17+ was also
removed). Any earlier project note that referenced a "12+" target (e.g. the pre-overhaul CONTEXT
wording "9+/12+") **predates this change and is stale** — do **not** present 12+ as a selectable
tier. The realistic decision for this game is **9+ vs 13+.**

### 2.2 What the content actually is

The scoring function is Yapoleon's taste, and his in-voice reactions are cutting but bound:

- **D-01 (output profanity):** mild words are OK (e.g. "damn", "hell"); **no slurs and no strong
  profanity.** Enforced as the SAFE-01 output bound.
- **D-02 (output target):** the barb lands on the **wit / line / attempt** — never the person, a
  protected trait, or a genuine vulnerability.
- **SAFE-02 (input red lines):** slurs/hate, credible threats, and sexual content involving minors
  are refused *before* the judge; the player gets an in-voice brush-off with the turn not consumed.

So the *strongest* content the game surfaces is **infrequent mild language inside witty, cutting
(but PG, non-slur, non-personal) banter.**

### 2.3 The 9+ vs 13+ reading

| Tier | Case for it | Case against it |
|------|-------------|-----------------|
| **9+** ("infrequent/mild") | The output bound is genuinely PG: mild profanity only, no slurs/strong profanity (D-01), barbs never target the person or protected traits (D-02), and red-line input is refused (SAFE-02). Apple's 9+ allows *infrequent/mild* mature-themes/language, which is a fair description of a witty emperor who says "damn" on occasion. | The register is *savage* in tone (even when clean), and a reviewer may read the sustained cutting/insult framing as more than "mild," nudging to 13+. |
| **13+** ("infrequent/mild → moderate") | Safest, most defensible default for an LLM-driven game with adversarial free-text input: even with SAFE-01/SAFE-02, a rating one step conservative absorbs reviewer subjectivity about tone and the residual risk inherent to generated text. | Arguably stricter than the actual PG output warrants; may narrow the audience for a game whose content is, by policy, all-ages-safe. |

**Reasoning.** Given D-01's *mild-profanity-allowed* savagery, the content maps most naturally to
**9+ ("infrequent/mild mature themes/language")**. However, because the reactions are
**LLM-generated over adversarial free-text input**, **13+** is the conservative, defensible
fallback if the submission questionnaire's tone judgments (or Apple's review) read the sustained
cutting register as more than "infrequent/mild." Both are documented so the submission can pick
deliberately.

**This document does not lock a single number.** Per the locked design (line 179), the **rating is
decided explicitly at submission time.** The deliverable here is the *documented posture + the
9+-vs-13+ rationale*, not a committed rating.

### 2.4 Questionnaire answers this posture implies

The App Store Connect age-rating questionnaire should be answered consistently with the posture
above:

- **Profanity or Crude Humor:** *Infrequent/Mild* (mild words allowed by D-01; no slurs/strong
  profanity — SAFE-01). Not *Frequent/Intense*.
- **Mature/Suggestive Themes:** *Infrequent/Mild* at most (witty, cutting register; SAFE-02 refuses
  sexual-minor / hateful / threatening input outright).
- **Violence (cartoon/fantasy/realistic):** *None* (no violence depicted; SAFE-02 refuses credible
  threats in input).
- **Horror/Fear, Sexual Content & Nudity, Gambling, Contests:** *None*.
- **Medical/Treatment Information:** *None*.
- **User-Generated Content / unrestricted web / social:** The player submits free text to an
  LLM judge, and the *output* is bound by SAFE-01 and the *input* red lines by SAFE-02. There is
  **no unmoderated user-to-user UGC, no chat, no unrestricted web access**, and the shareable card
  is a locally generated image. Answer the UGC/controls sections accordingly (bounded, moderated
  generated content — not open UGC).
- **Data collection / tracking:** No PII collected (Section 1). The App Privacy "Data Not Collected"
  posture applies to gameplay identity; analytics use an opaque, PII-free id (§1.3).
- The **2025 questionnaire adds mandatory sections** (in-app controls/capabilities, medical/wellness,
  violent themes) — answer each consistently with "no violence, no medical content, bounded moderated
  generated content, no PII."

---

## 3. Cross-References

- **SAFE-01 output bound (Plan 04-01):** `src/safety/output-scan.ts`, `src/voice-integrity.test.ts`
  — the all-ages OUTPUT half (no slurs/strong profanity, never targets the person). This posture's
  §2.2 content description depends on that gate holding.
- **SAFE-02 input red lines (Plan 04-02):** `detectRedLines` in `api/_sanitize.js`, gated in
  `api/court-judge.js`; the in-voice brush-off in `src/RoundScreen.tsx`. The INPUT half (§1.2, §2.2).
- **Anonymous identity:** `src/court-identity.ts` (`getPlayerId`, `mintIdentity`) — §1.1.
- **Analytics (D-11):** PostHog project 469777; identify wiring lands in Plan 04-04 — §1.3.

---

*Requirement: SAFE-03 · Phase 4 (Safe, Capped & Measured) · Plan 04-02*
*Age tiers current as of the July 2025 Apple overhaul (4+/9+/13+/16+/18+; 12+ removed).*
*Final rating: decided at submission time (locked design line 179).*
