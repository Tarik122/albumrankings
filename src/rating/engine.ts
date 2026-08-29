/**
 * The rating engine: turns the append-only comparison log into ratings.
 *
 * The log is the source of truth. Ratings stored on album documents are a cache
 * of this computation, never the authority. That is what makes every tuning
 * decision in Glicko2Config reversible: change τ, change the period size,
 * change how ties are weighted, replay, and you get a corrected ranking out of
 * the same history.
 *
 * Comparisons are bucketed into fixed-size rating periods because Glicko-2 is
 * defined over batches. The final, partially-filled period is still evaluated
 * so the UI responds immediately after a vote; when it later fills up, that
 * same computation becomes the committed one, so there is never a divergence
 * between the rating shown and the rating stored.
 */

import {
  DEFAULT_CONFIG,
  type Glicko2Config,
  type Rating,
  type Result,
  defaultRating,
  updateRating,
} from './glicko2'
import { type Comparison, outcomeOf } from '../data/types'

export interface EngineConfig extends Glicko2Config {
  /** Comparisons per rating period. */
  periodSize: number
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  ...DEFAULT_CONFIG,
  periodSize: 15,
}

export interface AlbumRating extends Rating {
  /** Comparisons that fed the rating maths (ties included, skips excluded). */
  comparisonCount: number
  /** Every logged comparison involving this album, skips included. */
  loggedCount: number
  wins: number
  losses: number
  ties: number
  skips: number
}

export type RatingTable = Map<string, AlbumRating>

function blank(): AlbumRating {
  return {
    ...defaultRating(),
    comparisonCount: 0,
    loggedCount: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    skips: 0,
  }
}

/**
 * Replay the whole log and produce current ratings for every album id.
 *
 * `albumIds` seeds the table so albums with no comparisons yet still appear
 * (at the default 1500 ± 350) and so idle inflation reaches them.
 */
export function computeRatings(
  albumIds: Iterable<string>,
  comparisons: Comparison[],
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): RatingTable {
  const table: RatingTable = new Map()
  for (const id of albumIds) table.set(id, blank())

  // Skips carry no rating information by design, but we count them so the UI
  // can show them and matchmaking can avoid re-offering a pair you passed on.
  const rated: Comparison[] = []
  for (const c of sortByTime(comparisons)) {
    ensure(table, c.albumA)
    ensure(table, c.albumB)
    const outcome = outcomeOf(c)
    const a = table.get(c.albumA)!
    const b = table.get(c.albumB)!
    a.loggedCount += 1
    b.loggedCount += 1
    if (outcome === 'skip') {
      a.skips += 1
      b.skips += 1
      continue
    }
    if (outcome === 'tie') {
      a.ties += 1
      b.ties += 1
    } else if (outcome === 'a') {
      a.wins += 1
      b.losses += 1
    } else {
      b.wins += 1
      a.losses += 1
    }
    rated.push(c)
  }

  for (let i = 0; i < rated.length; i += config.periodSize) {
    applyPeriod(table, rated.slice(i, i + config.periodSize), config)
  }

  return table
}

/**
 * Apply one rating period. Every album is updated simultaneously against the
 * ratings held at the *start* of the period — that simultaneity is the point of
 * Glicko-2's period model, so results within a period cannot cascade.
 */
function applyPeriod(table: RatingTable, period: Comparison[], config: EngineConfig): void {
  const snapshot = new Map<string, Rating>()
  for (const [id, r] of table) {
    snapshot.set(id, { rating: r.rating, ratingDeviation: r.ratingDeviation, volatility: r.volatility })
  }

  const results = new Map<string, Result[]>()
  const push = (id: string, opponent: Rating, score: number) => {
    const list = results.get(id)
    if (list) list.push({ opponent, score })
    else results.set(id, [{ opponent, score }])
  }

  for (const c of period) {
    const ra = snapshot.get(c.albumA)
    const rb = snapshot.get(c.albumB)
    if (!ra || !rb) continue
    const outcome = outcomeOf(c)
    const scoreA = outcome === 'tie' ? 0.5 : outcome === 'a' ? 1 : 0
    push(c.albumA, rb, scoreA)
    push(c.albumB, ra, 1 - scoreA)
  }

  for (const [id, current] of table) {
    const played = results.get(id) ?? []
    const before = snapshot.get(id)!
    const updated = updateRating(before, played, config, current.comparisonCount)
    current.rating = updated.rating
    current.ratingDeviation = updated.ratingDeviation
    current.volatility = updated.volatility
    current.comparisonCount += played.length
  }
}

function ensure(table: RatingTable, id: string): void {
  if (!table.has(id)) table.set(id, blank())
}

function sortByTime(comparisons: Comparison[]): Comparison[] {
  return [...comparisons].sort((x, y) => x.comparedAt - y.comparedAt || x.id.localeCompare(y.id))
}
