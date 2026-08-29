import { describe, expect, it } from 'vitest'
import { DEFAULT_MATCHMAKING, pairKey, selectPair } from './matchmaking'
import type { AlbumRating, RatingTable } from './engine'
import type { Comparison } from '../data/types'

function entry(rating: number, rd: number, comparisonCount: number): AlbumRating {
  return {
    rating,
    ratingDeviation: rd,
    volatility: 0.06,
    comparisonCount,
    loggedCount: comparisonCount,
    wins: 0,
    losses: 0,
    ties: 0,
    skips: 0,
  }
}

/** A settled library: 40 albums spread over a realistic rating range. */
function settledLibrary(): { ids: string[]; ratings: RatingTable } {
  const ratings: RatingTable = new Map()
  const ids: string[] = []
  for (let i = 0; i < 40; i += 1) {
    const id = `alb${i}`
    ids.push(id)
    ratings.set(id, entry(1200 + i * 20, 60, 30))
  }
  return { ids, ratings }
}

/** A generator producing a fixed cycle, so tests never depend on Math.random. */
function cyclingRng(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

describe('pair selection', () => {
  it('returns nothing when there is nothing to compare', () => {
    expect(selectPair([], new Map(), [])).toBeNull()
    const one: RatingTable = new Map([['solo', entry(1500, 350, 0)]])
    expect(selectPair(['solo'], one, [])).toBeNull()
  })

  it('never pairs an album with itself', () => {
    const { ids, ratings } = settledLibrary()
    for (let i = 0; i < 500; i += 1) {
      const pair = selectPair(ids, ratings, [])!
      expect(pair.albumA).not.toBe(pair.albumB)
    }
  })

  it('prioritises the uncertain newcomer over 40 settled albums', () => {
    const { ids, ratings } = settledLibrary()
    ratings.set('newcomer', entry(1500, 350, 0))
    const all = [...ids, 'newcomer']

    let involved = 0
    for (let i = 0; i < 400; i += 1) {
      const pair = selectPair(all, ratings, [])!
      if (pair.albumA === 'newcomer' || pair.albumB === 'newcomer') involved += 1
    }

    // One album in 41. Uniform selection would involve it about 5% of the time;
    // the uncertainty weighting plus the placement bonus should far exceed that.
    expect(involved / 400).toBeGreaterThan(0.25)
  })

  it('spreads a newcomer across the library rather than re-asking near neighbours', () => {
    const { ids, ratings } = settledLibrary()
    ratings.set('newcomer', entry(1500, 350, 0))

    const opponents = new Set<string>()
    for (let i = 0; i < 300; i += 1) {
      const pair = selectPair([...ids, 'newcomer'], ratings, [])!
      if (pair.albumA === 'newcomer') opponents.add(pair.albumB)
      else if (pair.albumB === 'newcomer') opponents.add(pair.albumA)
    }

    // While RD is 350 the opponent target ranges across the whole distribution,
    // so placement should sample widely instead of circling one rating band.
    expect(opponents.size).toBeGreaterThan(10)
  })

  it('offers close, informative pairs once everything is settled', () => {
    const { ids, ratings } = settledLibrary()
    // Suppress wildcards so we are measuring the scored path only.
    const config = { ...DEFAULT_MATCHMAKING, wildcardRate: 0 }

    let closeEnough = 0
    const trials = 300
    for (let i = 0; i < trials; i += 1) {
      const pair = selectPair(ids, ratings, [], config)!
      const gap = Math.abs(ratings.get(pair.albumA)!.rating - ratings.get(pair.albumB)!.rating)
      if (gap <= 200) closeEnough += 1
    }
    expect(closeEnough / trials).toBeGreaterThan(0.8)
  })

  it('does not re-offer a pair that is still in cooldown', () => {
    const { ids, ratings } = settledLibrary()
    const recent: Comparison[] = []
    let t = 0
    for (let i = 0; i < 20; i += 1) {
      t += 1
      recent.push({ id: `c${i}`, albumA: `alb${i}`, albumB: `alb${i + 1}`, winner: `alb${i}`, comparedAt: t })
    }
    const blocked = new Set(recent.map((c) => pairKey(c.albumA, c.albumB)))
    const config = { ...DEFAULT_MATCHMAKING, wildcardRate: 0 }

    for (let i = 0; i < 500; i += 1) {
      const pair = selectPair(ids, ratings, recent, config)!
      expect(blocked.has(pairKey(pair.albumA, pair.albumB))).toBe(false)
    }
  })

  it('keeps a skipped pair out of rotation for much longer than a judged one', () => {
    const { ids, ratings } = settledLibrary()
    const log: Comparison[] = [
      { id: 'skip1', albumA: 'alb0', albumB: 'alb1', winner: 'skip', comparedAt: 1 },
    ]
    // Enough later traffic to clear the ordinary cooldown, but not the skip one.
    for (let i = 0; i < 50; i += 1) {
      log.push({ id: `c${i}`, albumA: 'alb20', albumB: 'alb21', winner: 'alb20', comparedAt: 2 + i })
    }
    const config = { ...DEFAULT_MATCHMAKING, wildcardRate: 0 }

    for (let i = 0; i < 400; i += 1) {
      const pair = selectPair(ids, ratings, log, config)!
      expect(pairKey(pair.albumA, pair.albumB)).not.toBe(pairKey('alb0', 'alb1'))
    }
  })

  it('re-offers an already-judged pair when the audit path fires', () => {
    const { ids, ratings } = settledLibrary()
    const log: Comparison[] = [
      { id: 'old', albumA: 'alb3', albumB: 'alb30', winner: 'alb30', comparedAt: 1 },
      { id: 'old2', albumA: 'alb4', albumB: 'alb31', winner: 'alb31', comparedAt: 2 },
    ]
    // First value triggers the wildcard branch, second selects the audit path,
    // third picks the entry from the older half of the log.
    const pair = selectPair(ids, ratings, log, DEFAULT_MATCHMAKING, cyclingRng([0.01, 0.1, 0]))!

    expect(pair.reason).toBe('audit')
    expect(pairKey(pair.albumA, pair.albumB)).toBe(pairKey('alb3', 'alb30'))
  })

  it('produces wildcards at roughly the configured rate', () => {
    const { ids, ratings } = settledLibrary()
    let wild = 0
    const trials = 3000
    for (let i = 0; i < trials; i += 1) {
      const pair = selectPair(ids, ratings, [], DEFAULT_MATCHMAKING)!
      if (pair.reason === 'wildcard' || pair.reason === 'audit') wild += 1
    }
    // No prior comparisons, so the audit path finds nothing and falls through
    // to the scored path; only the random half of the wildcards can land.
    expect(wild / trials).toBeGreaterThan(0.02)
    expect(wild / trials).toBeLessThan(0.1)
  })
})
