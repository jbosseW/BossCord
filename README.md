# BossCord

**An anonymous, ephemeral Discord-style chat platform with a built-in mini-game arcade and chip economy — Node.js/Socket.IO backend, buildless React frontend.**

## What it does

BossCord is real-time chat with public rooms and private servers (text/voice/video channels), designed around ephemerality: no accounts required to chat, and rooms/messages wipe daily at midnight UTC ("No accounts. No databases. No traces."). Auth is proof-of-work + a 4-digit PIN + session tokens. On top of the chat sits a full arcade — chess (with clocks), a trading card game, horse racing, pool, liero, plinko, coinflip, a virtual stock market, and an auction house — all sharing an in-game chip economy with a loot/gacha layer. Includes DMs with client-side crypto, friends, a social feed, moderation tools, and rate limiting.

## Status

**Live and deployed, feature-rich, thin on tests.** Runs in production on a KVM VPS via an mTLS deploy pipeline. All 107 server/client JS files are syntax-clean, the chess timer test passes, and the server smoke-boots cleanly. Rough edges:

- The **TCG trade + challenge flow is fully implemented server-side with no client UI** (dormant feature)
- No message editing/deletion, image attachments, or replies
- Essentially no automated test suite (one ad-hoc chess script)

## How to run

Requires Node 18+.

```
npm install
ACCOUNT_SECRET=<any-random-string> node server.js   # required to boot
# open http://localhost:3000
```

The React client is served statically from `public/` and uses `React.createElement` directly — **no build step, no bundler**. Runtime/account data lives under `data/` (gitignored). Server secrets load from environment variables (e.g. `ACCOUNT_SECRET`, `TENOR_KEY`); nothing sensitive is committed. Deployment tooling is not included in this repo.

## Screenshots

_TODO — add captures (a public room, the games hub, a chess match)._

## Known issues / roadmap

See [`docs/GAP_ANALYSIS.md`](docs/GAP_ANALYSIS.md). Priority: ship the dormant TCG trade UI + seed a jest/CI test suite → message edit/delete + replies → image attachments (ephemeral, purge on wipe) → daily leaderboards → push notifications. Deliberately *not* planned: persistent message history, webhooks/bots, read receipts (they contradict the "no traces" identity).

## AI development note

Developed with AI assistance — **Anthropic Claude** (Claude Code) for implementation and **OpenAI Codex** for review — following the "Jonah" engineer persona defined in `CLAUDE.md` (account-safety-first, read-before-writing, no dead code). Human direction owned architecture, product identity, and priorities. The 2026-07-02 first-commit + security audit was done with Claude. Audit the auth/PoW and economy paths yourself before trusting them in any real deployment.

## License

MIT — see [LICENSE](LICENSE).

## Art & audio licensing

This repo intentionally contains **no icon art**. The images under
`public/icons/` are purchased packs licensed to the project owner only and
are stripped from version control (see `public/icons/ASSETS_PLACEHOLDER.md`).
The app expects them at their original paths; production has its own copies.
