import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  comparisonInformation,
  conservativeRating,
  defaultRating,
  updateRating,
  winProbability,
  type Rating,
} from './glicko2'

/**
 * Glickman's own worked example from the Glicko-2 paper. Reproducing it exactly
 * is the only real proof the implementation is Glicko-2 and not a lookalike.
 * The paper uses τ = 0.5 and no RD ceiling, so we disable our extensions here.
 */
const PAPER_CONFIG = {
  ...DEFAULT_CONFIG,
  tau: 0.5,
  maxEstablishedRd: Infinity,
  establishedAfter: Infinity,
}

describe('Glicko-2 against the reference paper', () => {
  it("reproduces Glickman's worked example", () => {
    const player: Rating = { rating: 1500, ratingDeviation: 200, volatility: 0.06 }
    const updated = updateRating(
      player,
      [
        { opponent: { rating: 1400, ratingDeviation: 30, volatility: 0.06 }, score: 1 },
        { opponent: { rating: 1550, ratingDeviation: 100, volatility: 0.06 }, score: 0 },
        { opponent: { rating: 1700, ratingDeviation: 300, volatility: 0.06 }, score: 0 },
      ],
      PAPER_CONFIG,
    )

    // Published results: r' = 1464.06, RD' = 151.52, σ' = 0.059996.
    expect(updated.rating).toBeCloseTo(1464.06, 1)
    expect(updated.ratingDeviation).toBeCloseTo(151.52, 1)
    expect(updated.volatility).toBeCloseTo(0.059996, 6)
  })
})

describe('uncertainty behaviour', () => {
  it('shrinks RD as evidence accumulates', () => {
    let r = defaultRating()
    const opponent: Rating = { rating: 1500, ratingDeviation: 50, volatility: 0.06 }
    for (let i = 0; i < 10; i += 1) {
      r = updateRating(r, [{ opponent, score: 1 }], DEFAULT_CONFIG, i)
    }
    expect(r.ratingDeviation).toBeLessThan(defaultRating().ratingDeviation)
    expect(r.rating).toBeGreaterThan(1500)
  })

  it('inflates RD only gently when an album sits out a period', () => {
    const settled: Rating = { rating: 1600, ratingDeviation: 80, volatility: 0.06 }
    const idle = updateRating(settled, [], DEFAULT_CONFIG, 20)
    expect(idle.rating).toBe(1600)
    expect(idle.ratingDeviation).toBeGreaterThanOrEqual(80)
    expect(idle.ratingDeviation).toBeLessThan(80.1)
  })

  it('damps idle inflation far below textbook Glicko-2 over a long absence', () => {
    // The real risk this guards against: in a library of hundreds, almost every
    // album sits out almost every period. Undamped, RD climbs back towards 350
    // and the ranking dissolves into uncertainty. Cap disabled so the two are
    // compared on inflation alone.
    const noCap = { ...DEFAULT_CONFIG, maxEstablishedRd: Infinity, establishedAfter: Infinity }
    const undamped = { ...noCap, idleInflation: 1 }
    const settled: Rating = { rating: 1600, ratingDeviation: 80, volatility: 0.06 }

    let damped = settled
    let textbook = settled
    for (let i = 0; i < 200; i += 1) {
      damped = updateRating(damped, [], noCap, 40)
      textbook = updateRating(textbook, [], undamped, 40)
    }

    expect(textbook.ratingDeviation).toBeGreaterThan(150)
    expect(damped.ratingDeviation).toBeLessThan(90)
  })

  it('caps RD for established albums', () => {
    let r: Rating = { rating: 1500, ratingDeviation: 340, volatility: 0.06 }
    for (let i = 0; i < 200; i += 1) r = updateRating(r, [], DEFAULT_CONFIG, 50)
    expect(r.ratingDeviation).toBeLessThanOrEqual(DEFAULT_CONFIG.maxEstablishedRd)
  })
})

describe('volatility absorbs a single surprise', () => {
  it('moves a well-established rating less than an uncertain one', () => {
    const strongOpponent: Rating = { rating: 1500, ratingDeviation: 60, volatility: 0.06 }

    // An album with a long consistent record, versus a brand new one.
    let established: Rating = { rating: 1800, ratingDeviation: 60, volatility: 0.06 }
    let fresh: Rating = { rating: 1800, ratingDeviation: 350, volatility: 0.06 }

    // The same surprising loss hits both.
    established = updateRating(established, [{ opponent: strongOpponent, score: 0 }], DEFAULT_CONFIG, 60)
    fresh = updateRating(fresh, [{ opponent: strongOpponent, score: 0 }], DEFAULT_CONFIG, 0)

    const establishedDrop = 1800 - established.rating
    const freshDrop = 1800 - fresh.rating
    expect(establishedDrop).toBeGreaterThan(0)
    expect(freshDrop).toBeGreaterThan(establishedDrop * 3)
  })
})

describe('derived helpers', () => {
  it('reports a near coin-flip between equals and confidence between extremes', () => {
    const a: Rating = { rating: 1500, ratingDeviation: 50, volatility: 0.06 }
    const b: Rating = { rating: 1500, ratingDeviation: 50, volatility: 0.06 }
    expect(winProbability(a, b)).toBeCloseTo(0.5, 6)

    const strong: Rating = { rating: 2000, ratingDeviation: 50, volatility: 0.06 }
    expect(winProbability(strong, b)).toBeGreaterThan(0.9)
  })

  it('values a toss-up above a foregone conclusion', () => {
    const a: Rating = { rating: 1500, ratingDeviation: 50, volatility: 0.06 }
    const equal: Rating = { rating: 1510, ratingDeviation: 50, volatility: 0.06 }
    const mismatch: Rating = { rating: 2200, ratingDeviation: 50, volatility: 0.06 }
    expect(comparisonInformation(a, equal)).toBeGreaterThan(comparisonInformation(a, mismatch))
  })

  it('ranks a proven album above an unproven one at the same rating', () => {
    const proven: Rating = { rating: 1600, ratingDeviation: 50, volatility: 0.06 }
    const unproven: Rating = { rating: 1600, ratingDeviation: 300, volatility: 0.06 }
    expect(conservativeRating(proven)).toBeGreaterThan(conservativeRating(unproven))
  })
})
