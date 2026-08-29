import { describe, expect, it } from 'vitest'
import { DEFAULT_ENGINE_CONFIG, computeRatings, type RatingTable } from './engine'
import { conservativeRating } from './glicko2'
import type { Comparison } from '../data/types'

/** Deterministic RNG so a failure here is always reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Eight albums, best first. The order the engine is expected to recover. */
const TRUE_ORDER = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']
const rankOf = (id: string) => TRUE_ORDER.indexOf(id)

let clock = 0
function comparison(albumA: string, albumB: string, winner: string): Comparison {
  clock += 1000
  return { id: `c${clock}`, albumA, albumB, winner, comparedAt: clock }
}

/** Every pair, `rounds` times over, judged in line with the true order. */
function honestLog(rounds: number, seed: number): Comparison[] {
  const rng = mulberry32(seed)
  const out: Comparison[] = []
  for (let round = 0; round < rounds; round += 1) {
    for (let i = 0; i < TRUE_ORDER.length; i += 1) {
      for (let j = i + 1; j < TRUE_ORDER.length; j += 1) {
        // Randomise which side is presented first, as the real UI would.
        const flip = rng() < 0.5
        const a = flip ? TRUE_ORDER[j] : TRUE_ORDER[i]
        const b = flip ? TRUE_ORDER[i] : TRUE_ORDER[j]
        out.push(comparison(a, b, TRUE_ORDER[i]))
      }
    }
  }
  return out
}

function ordering(table: RatingTable): string[] {
  return [...table.entries()]
    .sort(([, x], [, y]) => conservativeRating(y) - conservativeRating(x))
    .map(([id]) => id)
}

describe('convergence on a known order', () => {
  it('recovers the true order from consistent comparisons', () => {
    const table = computeRatings(TRUE_ORDER, honestLog(3, 1), DEFAULT_ENGINE_CONFIG)
    expect(ordering(table)).toEqual(TRUE_ORDER)
  })

  it('still recovers the true order despite a deliberately wrong comparison', () => {
    const log = honestLog(3, 2)

    // The noise this whole project exists to survive: one careless answer, and
    // the most extreme one available — the worst album beats the best. Dropped
    // into the middle of the log so several periods run after it.
    const upsetAt = Math.floor(log.length / 2)
    log.splice(upsetAt, 0, comparison('a1', 'a8', 'a8'))

    const table = computeRatings(TRUE_ORDER, log, DEFAULT_ENGINE_CONFIG)

    expect(ordering(table)).toEqual(TRUE_ORDER)
    expect(table.get('a1')!.rating).toBeGreaterThan(table.get('a8')!.rating)
  })

  it('absorbs the wrong comparison rather than swinging on it', () => {
    const clean = computeRatings(TRUE_ORDER, honestLog(3, 3), DEFAULT_ENGINE_CONFIG)

    const noisy = honestLog(3, 3)
    noisy.splice(Math.floor(noisy.length / 2), 0, comparison('a1', 'a8', 'a8'))
    const shaken = computeRatings(TRUE_ORDER, noisy, DEFAULT_ENGINE_CONFIG)

    // The upset should register — we are not throwing data away — but the gap
    // between best and worst must survive it substantially intact.
    const cleanGap = clean.get('a1')!.rating - clean.get('a8')!.rating
    const shakenGap = shaken.get('a1')!.rating - shaken.get('a8')!.rating
    expect(shakenGap).toBeLessThan(cleanGap)
    expect(shakenGap).toBeGreaterThan(cleanGap * 0.6)
  })

  it('places a newly added album into the right region of an existing ranking', () => {
    const log = honestLog(3, 4)

    // A newcomer that genuinely belongs third: it beats a4 and below, loses to
    // a1 and a2. Five comparisons, the placement target.
    for (const loser of ['a4', 'a5', 'a6']) log.push(comparison('new', loser, 'new'))
    for (const winner of ['a1', 'a2']) log.push(comparison('new', winner, winner))

    const table = computeRatings([...TRUE_ORDER, 'new'], log, DEFAULT_ENGINE_CONFIG)
    const order = ordering(table)
    const placed = order.indexOf('new')

    // It cannot beat well-established albums on the conservative measure yet —
    // five comparisons is not much evidence — but on raw rating it must land
    // between the albums it beat and the ones it lost to.
    expect(placed).toBeGreaterThan(0)
    expect(table.get('new')!.rating).toBeGreaterThan(table.get('a5')!.rating)
    expect(table.get('new')!.rating).toBeLessThan(table.get('a1')!.rating)
  })
})

describe('outcome handling', () => {
  it('excludes skips from the rating maths but keeps them in the record', () => {
    const withSkips = [
      comparison('a1', 'a2', 'skip'),
      comparison('a1', 'a3', 'skip'),
      ...honestLog(2, 5),
    ]
    const without = honestLog(2, 5)

    const skipped = computeRatings(TRUE_ORDER, withSkips, DEFAULT_ENGINE_CONFIG)
    const plain = computeRatings(TRUE_ORDER, without, DEFAULT_ENGINE_CONFIG)

    expect(skipped.get('a1')!.skips).toBe(2)
    expect(skipped.get('a1')!.comparisonCount).toBe(plain.get('a1')!.comparisonCount)
    expect(skipped.get('a1')!.rating).toBeCloseTo(plain.get('a1')!.rating, 6)
  })

  it('pulls two albums together when they are repeatedly tied', () => {
    const log: Comparison[] = []
    for (let i = 0; i < 20; i += 1) log.push(comparison('x', 'y', 'tie'))
    // Anchor them apart first, then tie them repeatedly.
    const seeded = [
      ...Array.from({ length: 10 }, () => comparison('x', 'z', 'x')),
      ...Array.from({ length: 10 }, () => comparison('y', 'z', 'z')),
      ...log,
    ]
    const table = computeRatings(['x', 'y', 'z'], seeded, DEFAULT_ENGINE_CONFIG)
    const gapAfterTies = Math.abs(table.get('x')!.rating - table.get('y')!.rating)

    const noTies = computeRatings(['x', 'y', 'z'], seeded.slice(0, 20), DEFAULT_ENGINE_CONFIG)
    const gapBefore = Math.abs(noTies.get('x')!.rating - noTies.get('y')!.rating)

    expect(table.get('x')!.ties).toBe(20)
    expect(gapAfterTies).toBeLessThan(gapBefore)
  })

  it('is deterministic — the same log always produces the same ratings', () => {
    const log = honestLog(2, 6)
    const first = computeRatings(TRUE_ORDER, log, DEFAULT_ENGINE_CONFIG)
    const second = computeRatings(TRUE_ORDER, [...log].reverse(), DEFAULT_ENGINE_CONFIG)
    for (const id of TRUE_ORDER) {
      expect(second.get(id)!.rating).toBeCloseTo(first.get(id)!.rating, 9)
    }
  })
})
