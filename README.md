# Album Ranker

Rank a large, growing album library by pairwise comparison — "which of these two
is better?" — instead of inventing scores out of nowhere.

Static site: React + Vite + Firebase, deployed to GitHub Pages. No backend.

## Why pairwise, and why Glicko-2

Assigning an album 8.5/10 requires a scale you don't really have. Picking
between two albums is a judgement you can actually make. But any single
comparison might be careless or mood-driven, so the rating system has to absorb
that rather than trust each answer.

Glicko-2 tracks three numbers per album: a rating, an uncertainty (RD), and a
**volatility**. An album with a long consistent record has low volatility, so a
surprising result nudges its uncertainty up rather than swinging its rating. One
bad answer doesn't wreck a ranking.

Every comparison is written to an append-only log, and ratings are recomputed by
replaying that log. Nothing is baked in — tuning the algorithm re-scores your
whole history.

You can also say **"too close to call"** (a real tie, which pulls two ratings
together) or **"skip"** (no opinion, recorded but excluded from the maths).
Forcing a preference you don't have is exactly the noise this avoids.

## Setup

See **[SETUP.md](./SETUP.md)** — Firebase, Spotify, and GitHub Pages, in order.
About 30 minutes.

## Development

```bash
npm install
cp .env.example .env.local   # fill in — see SETUP.md
npm run dev                  # http://127.0.0.1:5173/albumrankings/
npm test                     # 33 tests
npm run build
```

`127.0.0.1`, not `localhost` — Spotify won't accept `localhost` as a redirect
URI, so the dev server binds to the loopback IP to match.

## Architecture

See **[CLAUDE.md](./CLAUDE.md)** for the design decisions and the reasoning
behind them — rating periods, the two deliberate departures from textbook
Glicko-2, how matchmaking picks pairs, and which Spotify endpoints no longer
exist.
