# Album Ranker — architecture and decisions

A single-user web app that ranks an album library by pairwise comparison
("which of these two is better?") rather than by assigning scores. Static site,
no backend of any kind.

This file exists so a future session does not have to re-derive the reasoning
below. If you change one of these decisions, change this file too.

## Constraints that shaped everything

- **Static hosting only.** GitHub Pages. No server, no serverless functions, no
  backend. Everything — including the Spotify OAuth flow — runs in the browser.
- **Single user.** There is no account system, no invites, no roles. Firebase
  Auth exists only to produce a UID that the Firestore rules can be pinned to.
- **The library is large and always growing.** Hundreds of albums now, more
  indefinitely. Nothing may assume every pair will eventually be compared.
- **The judge is fallible.** Any individual comparison may be careless,
  inconsistent, or mood-driven. The system has to absorb that.

## Stack

React 19 + Vite + TypeScript + Tailwind v4 + Firebase JS SDK (Firestore +
Auth). Vitest for tests.

- **TypeScript**, though the brief did not specify it: the rating maths and the
  Firestore document shapes are exactly where a silent type error would be
  expensive and invisible.
- **No router.** Four tabs held in component state. This avoids the GitHub
  Pages SPA-404 problem entirely and keeps the Spotify redirect URI a clean,
  fragment-free base URL, which Spotify requires.
- **Firebase over Supabase.** Two small collections, no relational queries, no
  reason to prefer Postgres. Not worth the switching cost.

## The central design decision: the log is the source of truth

`comparisons/` is an append-only log. Ratings are a **pure function** of that
log, recomputed by replaying it (`src/rating/engine.ts`). The `rating`,
`ratingDeviation`, `volatility` and `comparisonCount` fields on `albums/`
documents are a **cache**, written back after each replay, and nothing ever
treats them as authoritative.

This costs almost nothing — a few thousand comparisons over a few hundred
albums replays in well under a frame — and buys the property the whole project
depends on: **every tuning decision is reversible.** Change τ, change the
rating period size, change how ties are weighted, and the entire history is
re-scored correctly on the next load. Had ratings been stored incrementally,
each of those knobs would have been a one-way door.

The Firestore rules enforce append-only server-side: `create` is allowed,
`update` and `delete` are denied outright.

## Glicko-2

Implemented in `src/rating/glicko2.ts` from Glickman's specification, and
verified in `glicko2.test.ts` against the worked example in that paper. Do not
"simplify" this module without re-running that test — it is the only thing
proving this is Glicko-2 and not a lookalike.

Each album carries a rating (μ, ~1500-centred), a rating deviation (RD/φ, its
uncertainty), and a volatility (σ, how erratic its results have been). New
albums start at 1500 ± 350.

**Why Glicko-2 and not Elo:** the volatility term is what makes one biased or
careless answer survivable. An album with a long consistent record has low σ, so
a surprising result produces a large Δ against small volatility — the solver
raises σ modestly instead of swinging μ. That mechanism *is* the outlier
handling; there is deliberately no separate outlier-rejection layer bolted on.

### Rating periods

Glicko-2 is defined over *batches* of games, not single results — the batching
is where the volatility estimate gets its stability. So comparisons are bucketed
into fixed-size rating periods (default 15, `EngineConfig.periodSize`).

The final, partially-filled period is still evaluated, so the UI moves the
moment you vote. When that period later fills, the same computation becomes the
committed one — so the rating shown and the rating stored never diverge.

Within a period, every album is updated simultaneously against the ratings held
at the *start* of the period. Results inside one period cannot cascade into each
other. That is what makes the replay order-independent, which `engine.test.ts`
asserts directly.

### Two deliberate departures from textbook Glicko-2

Both are in `Glicko2Config` and both are documented at their definitions.

1. **Idle RD inflation is damped** (`idleInflation`, default 0.15). Standard
   Glicko-2 inflates a player's uncertainty every period they do not play,
   because human skill drifts during inactivity. Album quality does not drift —
   only the listener's opinion does, and far more slowly. Applied unmodified to
   a 500-album library where each period touches ~30 slots, almost every album
   would be inflated almost every period, and RD would climb back towards 350
   until the ranking dissolved into uncertainty. `glicko2.test.ts` covers this
   directly, comparing damped against textbook behaviour over 200 idle periods.

2. **RD is capped for established albums** (`maxEstablishedRd` 150, after
   `establishedAfter` 5 comparisons), as a second line of defence on the same
   problem.

If these ever look wrong, they are safe to change — replay fixes the history.

### Outcomes

Four outcomes, and the distinction between the last two matters:

| Outcome | Stored `winner` | Effect on ratings |
|---|---|---|
| A wins | `albumA`'s id | s = 1 for A |
| B wins | `albumB`'s id | s = 1 for B |
| Tie | `'tie'` | s = 0.5 both sides — a real signal that pulls them together |
| Skip | `'skip'` | **none** — logged for the record, excluded from the maths |

A tie means "these are genuinely equal", which is information. A skip means "I
cannot judge this pair", which is missing data. Feeding a skip in as a draw
would record a claim about equality that was never made — exactly the noise this
project exists to avoid. Skips also put the pair into a long matchmaking
cooldown (`skipCooldown`, 200 comparisons).

## Reviews and personal scores

`review` (free text) and `personalScore` (0–10) live on the album document and
are **never read by the rating engine**. The ranking stays a pure function of
the comparison log; your own score is a second, independent opinion sitting
beside it. Where the two disagree is the interesting part, so do not be tempted
to feed the score in as a prior — that would put an arbitrary number back into
a system built to avoid them, and would break replay reproducibility, since the
seed would live outside the log.

## The public page

Signed-out visitors get `PublicView` at the same URL the owner uses. One link,
no router, no dead end for anyone who follows it.

Two things make this work:

- **`isPublic` is real access control, not a UI flag.** The Firestore rule is
  `allow read: if isOwner() || resource.data.isPublic == true`, and Firestore
  evaluates that against the *query*, not the results — a listing that does not
  constrain `isPublic == true` is rejected outright rather than quietly
  filtered. `fetchPublicAlbums()` therefore queries with that exact `where`
  clause. A private album and its review are genuinely unreachable.
- **The public page reads the cached ratings on album documents**, because the
  comparison log stays owner-only and cannot be replayed by a visitor. This is
  the one consumer that depends on the cache being fresh; it is written back on
  every owner visit, so the public page trails by at most one visit.

`hasStoredVisibility` is a read-time marker (never written) that lets
`backfillPublicFlag` find albums predating the field. `isPublic` defaults to
true on read, so without the marker those albums would be indistinguishable from
genuinely public ones — but the rule matches the *stored* value, so they must be
written to actually appear.

## Matchmaking

`src/rating/matchmaking.ts`. Priorities, in order:

1. **Place new / high-uncertainty albums.** The first slot is a weighted
   lottery on RD² with a bonus for albums below `placementTarget`.
2. **Otherwise, the most informative pair**: close ratings, with real
   uncertainty on at least one side.
3. **~10% wildcard**, half of which re-offers an already-judged pair to catch
   drift and contradictions (`reason: 'audit'`).

Two things worth preserving:

- **The scoring function is Glicko-2's own information term.**
  `comparisonInformation()` is the per-opponent term of the variance estimate
  `v` — the Fisher information of the comparison. It peaks exactly when the
  outcome is a genuine toss-up. Multiplying it by the summed RD is what
  expresses "close *and* still uncertain". No separate heuristic needed.
- **Placement spread falls out of RD itself.** A newcomer's opponent is aimed at
  `rating ± random × RD`. At RD 350 that ranges across the whole library; as the
  estimate firms up, the same rule automatically narrows onto near neighbours.
  There is no separate binary-search ladder, and there does not need to be.

  The aim is applied by **scoring candidates against the aimed-at rating**, not
  merely by centring the candidate window on it. Centring alone was a real bug:
  when the library is smaller than `candidateWindow` (60) the window covers
  everything, so the aim had no effect at all — precisely when a library is
  young and placement matters most. `matchmaking.test.ts` measures the mean
  opponent distance at RD 350 against RD 40 to keep this honest.

`selectPair` also accepts `focusAlbumId`, which restricts every pair to one
album. That is what powers "rate this album now" after an import: the opponent
still comes from the normal second-slot logic, so placement behaves identically,
just concentrated. Wildcards and audits are skipped in a focused run — spending
one of six comparisons on an unrelated pair would defeat the point.

Selection is **O(albums) per call, not O(albums²)**: one side by lottery, then
only a windowed slice of candidates scored for the other. Keep it that way — the
library is meant to grow indefinitely.

## Data model

`albums/{autoId}` — `title`, `artist`, `spotifyAlbumId` (nullable), `artUrl`,
`releaseYear`, `addedAt`, `source`, `dedupKey`, `rating`, `ratingDeviation`,
`volatility`, `comparisonCount`, `review`, `personalScore`, `reviewUpdatedAt`,
`isPublic`.

Fields added after the first release are filled in by `normaliseAlbum()` on
read, so an older document without them is not a special case anywhere else.

`comparisons/{autoId}` — `albumA`, `albumB`, `winner` (an album id, or `'tie'`,
or `'skip'`), `comparedAt`.

**Document ids are Firestore auto-ids, not Spotify ids.** Deduplication runs on
`spotifyAlbumId` first, then on `dedupKey` — a normalised `artist::title` that
strips case, accents, punctuation, and the edition suffixes Spotify appends
("Deluxe", "Remastered", "… Anniversary Edition"). This is deliberate: an album
added by hand today can be matched to Spotify later *without changing its id*,
so every comparison already logged against it survives. Keying documents by
Spotify id would have made that migration orphan its own history.

`winner` stores an album **id** rather than `'a'`/`'b'` so a log entry stays
meaningful on its own.

## Spotify

`src/spotify/`. Authorization Code with **PKCE** — the only flow that works from
a static site with no backend to hold a secret. Tokens live in `localStorage`,
the PKCE verifier in `sessionStorage` (single-use, should not outlive its tab).

Access tokens expire in an hour, so refresh handling is not optional. Spotify
rotates the refresh token on some refreshes, so the response is always re-read
for a new one. Concurrent callers share one in-flight refresh, so a burst of
imports cannot spend the refresh token twice.

Scopes: `user-top-read`, `user-read-recently-played`.

### API constraints under the current developer rules

These are not oversights — do not "fix" them by reaching for the endpoints
below:

- **`/me/albums` (saved albums) is the best source and has no cap.** It pages
  through the whole saved library and reflects an explicit choice rather than
  something inferred from track plays. Needs the `user-library-read` scope,
  which was added after the first release — `hasScope()` detects a connection
  predating it so the UI can ask for a reconnect instead of failing with a 403.
- **There is no "top albums" endpoint.** Top albums are approximated from
  `/me/top/tracks` across all three time ranges, rolled up to parent albums,
  weighted by track rank. `limit` caps at 50 but `offset` reaches 49, so two
  requests per range get ~99 tracks.
- **Filter releases on `total_tracks`, never on `album_type`.** Spotify labels a
  great many EPs — five, six, eight tracks — as `"single"`. Filtering on that
  field silently drops real releases; this was a live bug.
- **`/me/player/recently-played` caps at 50 items** with no deeper history. The
  suggestion feed is a rolling window, not a full play log.
- **Album search `limit` maxes at 10**, not 50. The search UX is built for
  narrow queries (artist + album together), not paging.
- **The batch "several albums" endpoint was removed.** `/albums/{id}` is one at
  a time — use `throttled()` in `api.ts` when enriching many.
- **Album `popularity` was removed** from the album object. Nothing may depend
  on it.
- **Removed entirely, do not use:** `/artists/{id}/top-tracks`,
  `/browse/new-releases`, `/recommendations`, `/audio-features`,
  `/audio-analysis`, `/related-artists`.
- **Developer Mode** requires the owner's Spotify account to be Premium and
  listed in the app's user-management page. A 403 almost always means one of
  those two, and `api.ts` says so in the error message.

## Security

The Firebase config and the Spotify client id are **public**, and that is fine —
GitHub Pages serves a public bundle, so anything shipped in it is visible.
Security comes entirely from `firestore.rules`.

The rules check `request.auth.uid == '<specific UID>'`, **not**
`request.auth != null`. Anyone can create a Google account and authenticate
against this Firebase project, so "is signed in" would be no protection at all.

`isOwner()` in `src/data/auth.ts` is a UI convenience only — it shows a useful
message instead of a wall of permission-denied errors. It is not enforcement and
cannot be.

**Sign-in is `signInWithPopup`, not `signInWithRedirect`, and must stay that
way.** The redirect flow needs to read a pending credential back from storage on
the Firebase auth domain after returning. Safari's tracking prevention
partitions that storage whenever the app is served from a different origin than
the auth domain — which is always true here (`*.github.io` versus
`*.firebaseapp.com`). Firebase's documented fixes are a reverse proxy or a
self-hosted auth handler, and a static host can provide neither. The popup runs
as a first-party context and works. The cost is that mobile Safari blocks
popups that don't open directly from a tap, so `signIn()` names that failure
explicitly rather than surfacing a raw `auth/popup-blocked`.

Setup order matters: before `VITE_OWNER_UID` is set, the app treats the first
signed-in user as owner so it can show them the UID they need to paste in. The
Settings tab warns loudly until this is done.

`SETUP.md` documents a **deploy-first** ordering, because the whole setup can be
done from an iPad with no local machine, and the UID is only visible by signing
in to a deployed build. That ordering is safe purely because Firestore in
production mode denies everything until the owner rule is published — so the
window between deploying and locking down grants no access. If that assumption
ever changes, the ordering has to change with it.

## Testing

`npm test` — 37 tests.

The one to protect: `engine.test.ts` builds eight albums with a known intended
order, generates consistent comparisons, then splices in a deliberately wrong
one (worst album beats best) and asserts the true order is still recovered. That
is the noise-resistance claim, checked rather than asserted.

`CompareView.test.tsx` covers the comparison UI with Firestore stubbed —
keyboard voting, tie-vs-skip, pair advancement, and the write-failure path.

**Every statistical assertion in `matchmaking.test.ts` uses a seeded RNG.** They
measure proportions — how often a newcomer comes up, how close the offered pairs
are — and on `Math.random` they fail a run every so often for no reason. If you
add one, seed it.

## Deliberately out of scope

Multi-user accounts. Any backend or serverless component. Offline support. A
native app. Anything needing Spotify Extended Quota approval.
