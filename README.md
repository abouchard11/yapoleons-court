# Yapoleon's Court

A daily **AI-native** game: win the favor of **Yapoleon**, a haughty AI emperor, by saying things clever and persuasive enough to move him. You don't trick him — you *charm* him. The character's *taste* is the scoring function.

Second game in the Yapoleon franchise (sibling to [yapword](https://yapword.com)). New mechanically; reuses the Yapoleon character and the yapword tech stack.

**Status:** 🎨 Design phase — no app code yet. Locked decisions and open questions live in
[`DESIGN.md`](DESIGN.md).

## What it is

- **Daily "win it over" loop:** Yapoleon poses a framed demand → you answer in free text → a visible **favor meter** plus an in-character reaction *score you, teach you why, and become the share* → fill the meter before your turns run out to earn his grudging concession.
- **The moat:** Yapoleon **remembers you** — your standing at court rises and falls, and his tone toward you evolves over time. A rivalry that compounds.

## Stack (intended — forks the yapword engine)

Vite · React · TypeScript · Capacitor (iOS, Android later) · Supabase · RevenueCat · Google Gemini (server-only proxy) · share-card generator · analytics + alerting.

## Origin

an internal design session, 2026-06-15. Design in progress — see the design doc for the full rationale, locked decisions, and the open-questions list.
