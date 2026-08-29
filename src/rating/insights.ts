/**
 * Reading structure out of the ranking.
 *
 * Everything here is derived from data already in the app — the comparison log,
 * the ratings it produces, and your own scores. No network, no external
 * service, and nothing that feeds back into the rating engine.
 *
 * This is what the recommender is built on. Spotify withdrew its
 * recommendation, related-artists and audio-feature endpoints for apps under
 * the current rules, so "albums like this one" is not available to ask for. But
 * a log of forced choices with an uncertainty on every one is a stronger
 * statement of taste than a pile of star ratings, and it is sitting right here.
 */

import type { Album } from '../data/types'
import type { Comparison } from '../data/types'
import { DEFAULT_ENGINE_CONFIG, computeRatings, type EngineConfig, type RatingTable } from './engine'
import { conservativeRating } from './glicko2'

/** An album counts towards taste only once it has some evidence behind it. */
const MIN_COMPARISONS = 3

export interface ArtistAffinity {
  artist: string
  /**
   * How far this artist sits above or below your library average, in rating
   * points, weighting each album by how certain its rating is.
   */
  affinity: number
  /** Summed precision behind that number. Higher means better evidenced. */
  confidence: number
  albums: Album[]
  best: Album
}

/**
 * Rank artists by how much you actually like them.
 *
 * Each album contributes its distance from the library mean, weighted by 1/RD²
 * — its precision. That is the standard way to combine estimates of differing
 * certainty, and it means an artist carried by one barely-compared album does
 * not outrank one with four well-established records.
 */
export function artistAffinities(albums: Album[], ratings: RatingTable): ArtistAffinity[] {
  const rated = albums.filter((a) => (ratings.get(a.id)?.comparisonCount ?? 0) >= MIN_COMPARISONS)
  if (rated.length === 0) return []

  const mean =
    rated.reduce((sum, a) => sum + (ratings.get(a.id)?.rating ?? 0), 0) / rated.length

  const byArtist = new Map<string, Album[]>()
  for (const album of rated) {
    const key = album.artist.trim().toLowerCase()
    const list = byArtist.get(key)
    if (list) list.push(album)
    else byArtist.set(key, [album])
  }

  const out: ArtistAffinity[] = []
  for (const group of byArtist.values()) {
    let weighted = 0
    let precision = 0
    let best = group[0]
    for (const album of group) {
      const r = ratings.get(album.id)!
      const w = 1 / (r.ratingDeviation * r.ratingDeviation)
      weighted += (r.rating - mean) * w
      precision += w
      if (r.rating > ratings.get(best.id)!.rating) best = album
    }
    out.push({
      artist: group[0].artist,
      affinity: weighted / precision,
      confidence: precision,
      albums: group,
      best,
    })
  }

  return out.sort((a, b) => b.affinity - a.affinity)
}

export interface Disagreement {
  album: Album
  /** Position in the ranking your comparisons produced, 1-based. */
  rankByComparison: number
  /** Position implied by the score you gave it, 1-based. */
  rankByScore: number
  /** Positive when you score it higher than your choices do. */
  gap: number
}

/**
 * Albums where your written score and your revealed preference part company.
 *
 * This is the payoff of keeping the two independent. A score is what you think
 * you think; the ranking is what you chose when actually made to choose. The
 * places they disagree are the interesting ones, and they only exist because
 * the score was never allowed to feed the rating.
 */
export function disagreements(albums: Album[], ratings: RatingTable): Disagreement[] {
  const eligible = albums.filter(
    (a) => a.personalScore !== null && (ratings.get(a.id)?.comparisonCount ?? 0) >= MIN_COMPARISONS,
  )
  if (eligible.length < 2) return []

  const byComparison = [...eligible].sort(
    (a, b) => ratings.get(b.id)!.rating - ratings.get(a.id)!.rating,
  )
  const byScore = [...eligible].sort((a, b) => b.personalScore! - a.personalScore!)

  const comparisonRank = new Map(byComparison.map((a, i) => [a.id, i + 1]))
  const scoreRank = new Map(byScore.map((a, i) => [a.id, i + 1]))

  return eligible
    .map((album) => {
      const rankByComparison = comparisonRank.get(album.id)!
      const rankByScore = scoreRank.get(album.id)!
      return { album, rankByComparison, rankByScore, gap: rankByComparison - rankByScore }
    })
    .filter((d) => d.gap !== 0)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
}

export interface MindChanger {
  album: Album
  /** Results that went against this album's eventual standing. */
  upsets: number
  /** Results counted, ties and skips excluded. */
  decided: number
  volatility: number
}

/**
 * Albums you have contradicted yourself on.
 *
 * Volatility is Glicko-2's own measure of inconsistency and is what ranks these,
 * but it is a poor thing to *show*: under consistent judging σ barely moves off
 * its starting value, so a list of them reads as identical numbers to four
 * decimal places. So the count that gets displayed is the number of results
 * that contradicted the album's eventual standing — it beat something rated
 * above it, or lost to something rated below.
 *
 * Albums with no contradictions at all are excluded rather than padding the
 * list: "you waver on this" is a claim, and it should only appear when true.
 */
export function mindChangers(
  albums: Album[],
  ratings: RatingTable,
  comparisons: Comparison[],
  limit = 8,
): MindChanger[] {
  const tally = new Map<string, { upsets: number; decided: number }>()
  const bump = (id: string, upset: boolean) => {
    const t = tally.get(id) ?? { upsets: 0, decided: 0 }
    t.decided += 1
    if (upset) t.upsets += 1
    tally.set(id, t)
  }

  for (const c of comparisons) {
    if (c.winner === 'skip' || c.winner === 'tie') continue
    const loserId = c.winner === c.albumA ? c.albumB : c.albumA
    const winner = ratings.get(c.winner)
    const loser = ratings.get(loserId)
    if (!winner || !loser) continue
    // Judged against final standings, so an "upset" is a result you would not
    // repeat given everything else you went on to say.
    const upset = winner.rating < loser.rating
    bump(c.winner, upset)
    bump(loserId, upset)
  }

  return albums
    .map((album) => {
      const t = tally.get(album.id) ?? { upsets: 0, decided: 0 }
      return {
        album,
        upsets: t.upsets,
        decided: t.decided,
        volatility: ratings.get(album.id)?.volatility ?? 0,
      }
    })
    .filter((m) => m.decided >= 5 && m.upsets > 0)
    .sort(
      (a, b) =>
        b.upsets / b.decided - a.upsets / a.decided ||
        b.volatility - a.volatility ||
        b.upsets - a.upsets,
    )
    .slice(0, limit)
}

/**
 * Albums you rank highly but have not been asked about in a long time.
 *
 * Not a correctness problem — the ranking is not stale in any technical sense —
 * but the audit path only re-offers old pairs occasionally, and these are the
 * ones where a stale verdict would matter most.
 */
export function staleFavourites(
  albums: Album[],
  ratings: RatingTable,
  comparisons: Comparison[],
  limit = 8,
): Album[] {
  const lastSeen = new Map<string, number>()
  comparisons.forEach((c, index) => {
    lastSeen.set(c.albumA, index)
    lastSeen.set(c.albumB, index)
  })

  const top = [...albums]
    .filter((a) => (ratings.get(a.id)?.comparisonCount ?? 0) >= MIN_COMPARISONS)
    .sort((a, b) => conservativeRating(ratings.get(b.id)!) - conservativeRating(ratings.get(a.id)!))
    .slice(0, Math.max(20, Math.floor(albums.length / 4)))

  return top
    .sort((a, b) => (lastSeen.get(a.id) ?? -1) - (lastSeen.get(b.id) ?? -1))
    .slice(0, limit)
}

export interface HistoryPoint {
  /** Comparisons completed at this point in the replay. */
  comparisons: number
  rating: number
}

/**
 * How one album's rating moved as the log accumulated.
 *
 * Only possible because ratings are a pure function of an append-only log:
 * replaying to any prefix is exact, not an approximation reconstructed from
 * stored snapshots. Costs one extra replay, which is cheap.
 */
export function ratingHistory(
  albumId: string,
  albumIds: string[],
  comparisons: Comparison[],
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): HistoryPoint[] {
  const points: HistoryPoint[] = []
  computeRatings(albumIds, comparisons, config, (periodIndex, table) => {
    const r = table.get(albumId)
    if (r) {
      points.push({ comparisons: (periodIndex + 1) * config.periodSize, rating: r.rating })
    }
  })
  return points
}
