// ============================================================================
// SAFE-02 — RoundScreen brush-off branch regression (the infinite-loop fix).
//
// The bug: on a moderation flag the UI hid the ReplyInput and showed a brush-off
// card whose "Try Again" button called submitTurn(reply.trim()) — resubmitting the
// SAME red-line text, which flags again → an infinite brush-off loop with no way to
// edit the reply.
//
// The contract (D-06): a flagged turn is NOT consumed and the player must EDIT the
// reply and retry. The fix keeps the editable ReplyInput + SubmitButton mounted during
// 'brushoff' and turns the brush-off into a passive in-voice BANNER that owns NO
// auto-resubmit button. The judge-FAILURE 'error' path is unchanged (it legitimately
// retries the same reply).
//
// These tests pin that contract at the seams the component exposes, without a DOM
// runtime (no jsdom in this project): the pure input-visibility predicate, and a
// static render of the brush-off banner (react-dom/server) asserting it owns no button.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { shouldShowReplyInput, BrushOffBanner, type UiPhase } from './RoundScreen';
import { scanForBannedProfanity, targetsPerson } from './safety/output-scan';

describe('SAFE-02 brush-off: the editable input stays mounted (no same-text resubmit loop)', () => {
  it('keeps the ReplyInput mounted during brushoff (the player can EDIT and resubmit)', () => {
    // THE fix: unlike the judge-failure error state, brushoff does NOT hide the input.
    expect(shouldShowReplyInput('brushoff', false)).toBe(true);
  });

  it('keeps the input mounted through the normal playing/pending/revealed states', () => {
    for (const phase of ['idle', 'pending', 'revealed', 'brushoff'] as UiPhase[]) {
      expect(shouldShowReplyInput(phase, false)).toBe(true);
    }
  });

  it('hides the input only for the judge-failure error state (which owns its own retry)', () => {
    // The error path is deliberately UNCHANGED — a failed judge call retries the same
    // reply via ErrorState, so the input is not needed there.
    expect(shouldShowReplyInput('error', false)).toBe(false);
  });

  it('hides the input once the round is finished (won/lost), in every phase', () => {
    for (const phase of ['idle', 'pending', 'revealed', 'error', 'brushoff'] as UiPhase[]) {
      expect(shouldShowReplyInput(phase, true)).toBe(false);
    }
  });
});

describe('SAFE-02 brush-off banner: passive in-voice message, NO auto-resubmit button', () => {
  const markup = renderToStaticMarkup(createElement(BrushOffBanner));

  it('renders NO button — it cannot own an auto-resubmit-the-same-text action', () => {
    // The old BrushOffState carried a "Try Again" <button> that re-issued the same
    // red-line reply. The banner must own no button at all; resubmission goes through
    // the normal ReplyInput + SubmitButton after the player edits the reply.
    expect(markup).not.toContain('<button');
    expect(markup.toLowerCase()).not.toContain('try again');
  });

  it('is an in-voice, screen-reader-announced brush-off that tells the player to edit', () => {
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('The Emperor will not stoop to answer that.');
    // It must direct the player to EDIT and resend (the fix's whole point).
    expect(markup.toLowerCase()).toContain('edit');
  });

  it('the brush-off copy itself passes the SAFE-01 all-ages output bound', () => {
    // The barb lands on the "gutter-talk" (the attempt), never the person/protected
    // trait, and carries no slur/strong profanity — SAFE-01 must hold on our own copy.
    const bannerText =
      'The Emperor will not stoop to answer that. ' +
      'Gutter-talk earns no audience. Edit your reply — bring wit, not filth — and send it again.';
    expect(scanForBannedProfanity(bannerText)).toBe(false);
    expect(targetsPerson(bannerText, { category: 'safe_copy', input: '' })).toBe(false);
  });
});
