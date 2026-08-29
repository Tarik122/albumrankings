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

/**
 * Seeded RNG.
 *
 * Every assertion below about *proportions* — how often a newcomer comes up,
 * how close the offered pairs are — is statistical, and left on Math.random it
 * would fail a run every so often for no reason. Seeding makes them ordinary
 * deterministic tests that still measure the real behaviour.
 */
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('pair selection', () => {
  it('returns nothing when there is nothing to compare', () => {
    expect(selectPair([], new Map(), [])).toBeNull()
    const one: RatingTable = new Map([['solo', entry(1500, 350, 0)]])
    expect(selectPair(['solo'], one, [])).toBeNull()
  })

  it('never pairs an album with itself', () => {
    const { ids, ratings } = settledLibrary()
    const rng = seeded(11)
    for (let i = 0; i < 500; i += 1) {
      const pair = selectPair(ids, ratings, [], DEFAULT_MATCHMAKING, { rng })!
      expect(pair.albumA).not.toBe(pair.albumB)
    }
  })

  it('prioritises the uncertain newcomer over 40 settled albums', () => {
    const { ids, ratings } = settledLibrary()
    ratings.set('newcomer', entry(1500, 350, 0))
    const all = [...ids, 'newcomer']

    const rng = seeded(22)
    let involved = 0
    for (let i = 0; i < 400; i += 1) {
      const pair = selectPair(all, ratings, [], DEFAULT_MATCHMAKING, { rng })!
      if (pair.albumA === 'newcomer' || pair.albumB === 'newcomer') involved += 1
    }

    // One album in 41. Uniform selection would involve it about 5% of the time;
    // the uncertainty weighting plus the placement bonus should far exceed that.
    expect(involved / 400).toBeGreaterThan(0.25)
  })

  it('spreads a newcomer across the library rather than re-asking near neighbours', () => {
    const { ids, ratings } = settledLibrary()
    ratings.set('newcomer', entry(1500, 350, 0))

    const rng = seeded(33)
    const opponents = new Set<string>()
    for (let i = 0; i < 300; i += 1) {
      const pair = selectPair([...ids, 'newcomer'], ratings, [], DEFAULT_MATCHMAKING, { rng })!
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

    const rng = seeded(44)
    let closeEnough = 0
    const trials = 300
    for (let i = 0; i < trials; i += 1) {
      const pair = selectPair(ids, ratings, [], config, { rng })!
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

    const rng = seeded(55)
    for (let i = 0; i < 500; i += 1) {
      const pair = selectPair(ids, ratings, recent, config, { rng })!
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

    const rng = seeded(66)
    for (let i = 0; i < 400; i += 1) {
      const pair = selectPair(ids, ratings, log, config, { rng })!
      expect(pairKey(pair.albumA, pair.albumB)).not.toBe(pairKey('alb0', 'alb1'))
    }
  })

  it('keeps every focused pair on the focused album', () => {
    const { ids, ratings } = settledLibrary()
    ratings.set('newcomer', entry(1500, 350, 0))
    const all = [...ids, 'newcomer']

    const rng = seeded(88)
    for (let i = 0; i < 300; i += 1) {
      const pair = selectPair(all, ratings, [], DEFAULT_MATCHMAKING, {
        focusAlbumId: 'newcomer',
        rng,
      })!
      expect(pair.reason).toBe('focus')
      expect(pair.albumA).toBe('newcomer')
      expect(pair.albumB).not.toBe('newcomer')
    }
  })

  it('spreads a focused newcomer across the library, then narrows as it settles', () => {
    // A 150-album library spanning 1000–2490, deliberately larger than the
    // 60-album candidate window: below that size the window covers everything
    // and there is nothing for the aim to do.
    const ratings: RatingTable = new Map()
    const ids: string[] = []
    for (let i = 0; i < 150; i += 1) {
      const id = `alb${i}`
      ids.push(id)
      ratings.set(id, entry(1000 + i * 10, 60, 30))
    }

    // Measured as how far the opponents sit from the newcomer, not how many
    // distinct ones appear — the count saturates and hides the effect.
    const meanGapAt = (rd: number) => {
      const rng = seeded(99)
      ratings.set('newcomer', entry(1750, rd, rd > 200 ? 0 : 30))
      let total = 0
      const trials = 400
      for (let i = 0; i < trials; i += 1) {
        const pair = selectPair([...ids, 'newcomer'], ratings, [], DEFAULT_MATCHMAKING, {
          focusAlbumId: 'newcomer',
          rng,
        })!
        total += Math.abs(ratings.get(pair.albumB)!.rating - 1750)
      }
      return total / trials
    }

    // The spread comes from RD alone: while the album is unknown its opponents
    // range across the library, and the same rule narrows onto near neighbours
    // once the estimate firms up. No separate placement ladder does this.
    expect(meanGapAt(350)).toBeGreaterThan(meanGapAt(40) * 1.5)
  })

  it('still returns a focused pair when everything nearby is in cooldown', () => {
    const { ids, ratings } = settledLibrary()
    ratings.set('newcomer', entry(1500, 60, 30))

    // Every possible partner already compared against, very recently.
    const log: Comparison[] = ids.map((id, i) => ({
      id: `c${i}`,
      albumA: 'newcomer',
      albumB: id,
      winner: 'newcomer',
      comparedAt: i + 1,
    }))

    const pair = selectPair([...ids, 'newcomer'], ratings, log, DEFAULT_MATCHMAKING, {
      focusAlbumId: 'newcomer',
    })
    expect(pair).not.toBeNull()
    expect(pair!.albumA).toBe('newcomer')
  })

  it('returns nothing when the focused album is not in the library', () => {
    const { ids, ratings } = settledLibrary()
    expect(
      selectPair(ids, ratings, [], DEFAULT_MATCHMAKING, { focusAlbumId: 'ghost' }),
    ).toBeNull()
  })

  it('never audits a pair that is still in cooldown', () => {
    const { ids, ratings } = settledLibrary()
    // One judged pair, answered just now: an audit of it would be asking a
    // question the user answered seconds ago.
    const log: Comparison[] = [
      { id: 'fresh', albumA: 'alb3', albumB: 'alb30', winner: 'alb30', comparedAt: 1 },
    ]

    const rng = seeded(121)
    for (let i = 0; i < 500; i += 1) {
      const pair = selectPair(ids, ratings, log, DEFAULT_MATCHMAKING, { rng })!
      expect(pairKey(pair.albumA, pair.albumB)).not.toBe(pairKey('alb3', 'alb30'))
    }
  })

  it('audits an old pair once it has left cooldown', () => {
    const { ids, ratings } = settledLibrary()
    const log: Comparison[] = [
      { id: 'old', albumA: 'alb3', albumB: 'alb30', winner: 'alb30', comparedAt: 1 },
    ]
    // Enough later traffic to age the pair past the ordinary cooldown.
    for (let i = 0; i < 40; i += 1) {
      log.push({ id: `c${i}`, albumA: 'alb10', albumB: 'alb11', winner: 'alb10', comparedAt: 2 + i })
    }

    // First value enters the wildcard branch, second selects the audit path,
    // third picks from the older half of the log.
    const pair = selectPair(ids, ratings, log, DEFAULT_MATCHMAKING, {
      rng: cyclingRng([0.01, 0.1, 0]),
    })!
    expect(pair.reason).toBe('audit')
    expect(pairKey(pair.albumA, pair.albumB)).toBe(pairKey('alb3', 'alb30'))
  })

  it('produces wildcards at roughly the configured rate', () => {
    const { ids, ratings } = settledLibrary()
    const rng = seeded(77)
    let wild = 0
    const trials = 3000
    for (let i = 0; i < trials; i += 1) {
      const pair = selectPair(ids, ratings, [], DEFAULT_MATCHMAKING, { rng })!
      if (pair.reason === 'wildcard' || pair.reason === 'audit') wild += 1
    }
    // No prior comparisons, so the audit path finds nothing and falls through
    // to the scored path; only the random half of the wildcards can land.
    expect(wild / trials).toBeGreaterThan(0.02)
    expect(wild / trials).toBeLessThan(0.1)
  })
})
