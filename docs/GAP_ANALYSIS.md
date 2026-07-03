# BossCord — Gap Analysis vs. Discord / Chat-Platform Staples

_Date: 2026-07-02. Basis: 107 server+client JS files syntax-clean, chess timer
tests pass, server smoke-boots clean (encryption on, graceful TLS degradation),
socket contract cross-checked both directions. Every "missing" claim below was
keyword-verified against handlers/, public/js/, and state.js._

## What BossCord already has (do not rebuild)

Ephemeral rooms + private servers with text/voice/video channels, PoW auth +
PIN + session tokens, encrypted account persistence with key rotation tooling,
daily UTC wipe, reactions (whitelisted emoji), pins (pin/unpin/get handlers),
typing indicators, DMs with client crypto, friends, profanity filter,
per-IP/socket rate limiting, moderation + report forwarding (mTLS), cords
social feed, PWA manifest, video roulette, and a full mini-game arcade:
chess (timed), TCG with packs/battles/tables, horse racing, pool, liero,
plinko, coinflip, stocks, auction house, clicker economy, loot/keys/scratch
cards, daily challenges. mTLS deploy pipeline to KVM.

---

## A. Chat-product gaps (verified absent)

### A1. Message editing & deletion — HIGH, users expect it everywhere
Zero edit handlers. Typo'd messages are permanent until the midnight wipe.
Edit-with-"(edited)"-marker + author-delete fit the ephemeral model fine.
**Hooks:** chat.js already owns the message lifecycle and broadcasts;
message IDs exist for reactions/pins, so targeting is already solved.

### A2. Image/file attachments — HIGH
No upload path at all (0 hits). Even ephemeral chats live on image sharing.
Ephemeral fits naturally: store to a tmpfs/quota'd dir, purge on daily wipe.
Rate-limit + size-cap via the existing ratelimit.js patterns; Tenor GIFs are
already integrated so the render path for media messages half-exists.

### A3. Replies / quoting — MEDIUM
No reply-to threading of any kind (thread hits are all worker-threads).
Full Discord threads contradict the ephemeral ethos, but lightweight
reply-with-preview (store `replyToId`, render quoted snippet) is cheap and
transforms busy public rooms.

### A4. Message search (in-channel) — LOW-MEDIUM
Only user search exists (for reports). In-memory state makes channel search
trivial — it's a filter over the existing message array, UI only.

### A5. Notifications — verify depth
Mentions/unread badges: partial signals exist (49 keyword hits, PWA manifest
present). Web Push for DMs/mentions while tabbed out is the retention lever;
service worker + push subscription is the missing piece to check.

Deliberately absent (fits product ethos — do NOT add): message history past
the wipe, webhooks/bots API, read receipts.

---

## B. Dormant feature: TCG trading & challenges — built server-side, no UI

`tcg.js` implements the full trade flow (`tcg_trade_proposed/received/
completed/declined/cancelled`) and direct battle challenges (`tcg_challenge_
sent/received/declined`) — and the client never emits a single request nor
registers a single listener for any of them. A complete feature is sitting
dark. Wiring the UI (propose from profile/card view, accept dialog) ships a
"new feature" with zero server work. Same pattern, smaller: `hr_bet_cancelled`,
`friend_requests_list`, `showcase_updated` acks have no client listeners —
sweep and either surface or drop them.

## C. Arcade/economy gaps (platform ideas from the genre)

- **Leaderboards + seasons:** stocks/clicker/races accumulate chips but nothing
  ranks players; a daily-wipe platform is *made* for daily leaderboards
  (challenges.js already tracks per-day counters).
- **Spectate links:** horse racing has spectator updates; chess/pool/liero
  don't. Shareable spectate = organic room traffic.
- **Tournaments:** chess has timed lobbies; a bracket wrapper over existing
  lobbies (auto-advance winners) is mostly UI + a scheduler.

## D. Engineering gaps

### D1. No test suite — the biggest risk
One ad-hoc chess timer script (`_test_timer.js`, passes) for a live deployed
platform with an economy. Chip mutations (loot, auction, stocks, coinflip)
are exactly where silent bugs cost trust. Port the MMOLite pattern: jest +
source-contract tests + an event-contracts test (this analysis found the TCG
gap by hand; the ratchet test would keep it found). Note: an emit/listen
sweep here must account for indirect broadcast fns (`_broadcastFn` in
horseracing.js) — naive regex flags false positives.

### D2. No CI
Repo is now on GitHub — add a workflow running syntax check + tests on push.

### D3. `_test_timer.js` placement
Move to `tests/` as the seed of the suite.

## Suggested sequencing

1. **B TCG trade UI** (server done, pure client work) + **D1 test seed + D2 CI**
2. **A1 edit/delete + A3 replies** — core chat feel
3. **A2 attachments** (ephemeral-friendly design above)
4. **C leaderboards** — leans on daily wipe identity
5. **A5 push notifications → A4 search → C tournaments**
