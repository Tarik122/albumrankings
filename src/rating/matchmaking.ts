/**
 * Choosing the next pair to compare.
 *
 * The library is large and always growing, so exhaustive pairwise comparison is
 * never the goal — every pair we offer has to earn its place. Priorities, in
 * the order the brief sets out:
 *
 *   1. Place new / high-uncertainty albums quickly.
 *   2. Otherwise offer the most *informative* pair: close ratings, with real
 *      uncertainty on at least one side.
 *   3. Occasionally offer a wildcard, sometimes a deliberate repeat of a pair
 *      already judged, to catch drift and contradictions over time.
 *
 * Everything here is O(albums) per call, not O(albums²): we pick one side by a
 * weighted lottery, then score only a windowed slice of candidates for the
 * other. That holds up as the library grows into the thousands.
 */

import { comparisonInformation, type Rating } from './glicko2'
import type { AlbumRating, RatingTable } from './engine'
import type { Comparison } from '../data/types'
import { outcomeOf } from '../data/types'

export type PairReason = 'placement' | 'informative' | 'wildcard' | 'audit'

export interface Pair {
  albumA: string
  albumB: string
  reason: PairReason
}

export interface MatchmakingConfig {
  /** Chance of ignoring the scoring and offering something unexpected. */
  wildcardRate: number
  /** Of those wildcards, the share that re-offer a pair already judged. */
  auditShare: number
  /** Comparisons before an album stops being treated as "being placed". */
  placementTarget: number
  /** Recently-offered pairs to avoid repeating (outside of a deliberate audit). */
  cooldownPairs: number
  /** How many candidates to score for the second slot. */
  candidateWindow: number
  /** Comparisons a skipped pair sits out before it may be offered again. */
  skipCooldown: number
}

export const DEFAULT_MATCHMAKING: MatchmakingConfig = {
  wildcardRate: 0.1,
  auditShare: 0.5,
  placementTarget: 5,
  cooldownPairs: 30,
  candidateWindow: 60,
  skipCooldown: 200,
}

type Rng = () => number

interface Candidate {
  id: string
  r: AlbumRating
}

export function selectPair(
  albumIds: string[],
  ratings: RatingTable,
  comparisons: Comparison[],
  config: MatchmakingConfig = DEFAULT_MATCHMAKING,
  rng: Rng = Math.random,
): Pair | null {
  const pool: Candidate[] = []
  for (const id of albumIds) {
    const r = ratings.get(id)
    if (r) pool.push({ id, r })
  }
  if (pool.length < 2) return null

  const blocked = blockedPairs(comparisons, config)

  if (rng() < config.wildcardRate) {
    const wild =
      rng() < config.auditShare
        ? auditPair(comparisons, ratings, rng)
        : randomPair(pool, blocked, rng)
    if (wild) return wild
  }

  const sorted = [...pool].sort((x, y) => x.r.rating - y.r.rating)
  const a = pickFirst(pool, config, rng)
  const b = pickSecond(a, sorted, blocked, config, rng)
  if (!b) {
    // Everything near A is blocked; fall back to any legal pair rather than
    // leaving the user with nothing to compare.
    return randomPair(pool, blocked, rng) ?? randomPair(pool, new Set(), rng)
  }

  const beingPlaced = a.r.comparisonCount < config.placementTarget
  return { albumA: a.id, albumB: b.id, reason: beingPlaced ? 'placement' : 'informative' }
}

/**
 * Priority 1: weight the lottery towards uncertainty. RD is squared so a fresh
 * album at RD 350 is roughly five times likelier to come up than an established
 * one at 150, and the bonus below sharpens that further for albums that have
 * not yet had their placement run.
 */
function pickFirst(pool: Candidate[], config: MatchmakingConfig, rng: Rng): Candidate {
  let total = 0
  const weights = pool.map((c) => {
    const rd = c.r.ratingDeviation
    const placementBonus = c.r.comparisonCount < config.placementTarget ? 3 : 1
    const w = rd * rd * placementBonus
    total += w
    return w
  })

  let roll = rng() * total
  for (let i = 0; i < pool.length; i += 1) {
    roll -= weights[i]
    if (roll <= 0) return pool[i]
  }
  return pool[pool.length - 1]
}

/**
 * Pick the opponent.
 *
 * For an album still being placed we aim at a rating offset from its own by a
 * random fraction of its RD. That produces exactly the deliberate spread the
 * brief asks for without any special-case ladder: while RD is 350 the opponents
 * range across the whole library, and as the estimate firms up the same rule
 * automatically narrows onto near neighbours.
 *
 * For a settled album we score a window of nearby candidates by the Fisher
 * information of the comparison — Glicko-2's own measure of how much a result
 * would tell us — and sample among the best.
 */
function pickSecond(
  a: Candidate,
  sorted: Candidate[],
  blocked: Set<string>,
  config: MatchmakingConfig,
  rng: Rng,
): Candidate | null {
  const beingPlaced = a.r.comparisonCount < config.placementTarget
  const target = beingPlaced
    ? a.r.rating + (rng() * 2 - 1) * a.r.ratingDeviation
    : a.r.rating

  const centre = nearestIndex(sorted, target)
  const half = Math.max(1, Math.floor(config.candidateWindow / 2))
  const lo = Math.max(0, centre - half)
  const hi = Math.min(sorted.length, centre + half + 1)

  const scored: { c: Candidate; score: number }[] = []
  for (let i = lo; i < hi; i += 1) {
    const c = sorted[i]
    if (c.id === a.id) continue
    if (blocked.has(pairKey(a.id, c.id))) continue
    scored.push({ c, score: pairScore(a.r, c.r) })
  }
  if (scored.length === 0) return null

  return sampleWeighted(scored, rng)
}

/**
 * How much a comparison is worth. The Fisher information term peaks when the
 * outcome is a genuine toss-up; multiplying by the summed uncertainty is what
 * expresses "close ratings *where at least one side is still uncertain*" —
 * two albums we already know well being close is not worth asking about again.
 */
function pairScore(a: Rating, b: Rating): number {
  const info = comparisonInformation(a, b)
  const uncertainty = a.ratingDeviation + b.ratingDeviation
  return info * uncertainty
}

function sampleWeighted(scored: { c: Candidate; score: number }[], rng: Rng): Candidate {
  // Cubing sharpens the preference for the best candidates while still leaving
  // room for variety, so consecutive sessions don't replay the same matchups.
  let total = 0
  const weights = scored.map(({ score }) => {
    const w = Math.pow(Math.max(score, 1e-9), 3)
    total += w
    return w
  })
  let roll = rng() * total
  for (let i = 0; i < scored.length; i += 1) {
    roll -= weights[i]
    if (roll <= 0) return scored[i].c
  }
  return scored[scored.length - 1].c
}

/** Priority 3a: re-offer a pair already judged, to detect drift. */
function auditPair(comparisons: Comparison[], ratings: RatingTable, rng: Rng): Pair | null {
  const judged = comparisons.filter(
    (c) => outcomeOf(c) !== 'skip' && ratings.has(c.albumA) && ratings.has(c.albumB),
  )
  if (judged.length === 0) return null
  // Bias towards the older half of the log: those are the verdicts most likely
  // to have gone stale.
  const span = Math.max(1, Math.floor(judged.length / 2))
  const pick = judged[Math.floor(rng() * span)]
  return { albumA: pick.albumA, albumB: pick.albumB, reason: 'audit' }
}

/** Priority 3b: a genuinely arbitrary pair. */
function randomPair(pool: Candidate[], blocked: Set<string>, rng: Rng): Pair | null {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const i = Math.floor(rng() * pool.length)
    let j = Math.floor(rng() * pool.length)
    if (i === j) j = (j + 1) % pool.length
    if (i === j) continue
    const key = pairKey(pool[i].id, pool[j].id)
    if (blocked.has(key)) continue
    return { albumA: pool[i].id, albumB: pool[j].id, reason: 'wildcard' }
  }
  return null
}

/**
 * Pairs we should not offer right now: anything compared in the last
 * `cooldownPairs` comparisons, plus anything skipped recently — a skip means
 * "I can't judge this", and asking again immediately is just noise.
 */
function blockedPairs(comparisons: Comparison[], config: MatchmakingConfig): Set<string> {
  const blocked = new Set<string>()
  const recent = comparisons.slice(-Math.max(config.cooldownPairs, config.skipCooldown))
  const start = recent.length
  for (let i = 0; i < recent.length; i += 1) {
    const c = recent[i]
    const age = start - i
    const isSkip = outcomeOf(c) === 'skip'
    const limit = isSkip ? config.skipCooldown : config.cooldownPairs
    if (age <= limit) blocked.add(pairKey(c.albumA, c.albumB))
  }
  return blocked
}

function nearestIndex(sorted: Candidate[], rating: number): number {
  let lo = 0
  let hi = sorted.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].r.rating < rating) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Order-independent key, so (a,b) and (b,a) are the same pair. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}
