import { describe, expect, it } from 'vitest'
import { computeRatings } from './engine'
import {
  artistAffinities,
  disagreements,
  mindChangers,
  ratingHistory,
  staleFavourites,
} from './insights'
import { makeDedupKey, type Album, type Comparison } from '../data/types'

let clock = 0
function comparison(albumA: string, albumB: string, winner: string): Comparison {
  clock += 1
  return { id: `c${clock}`, albumA, albumB, winner, comparedAt: clock }
}

function album(id: string, artist: string, title: string, personalScore: number | null = null): Album {
  return {
    id,
    title,
    artist,
    spotifyAlbumId: null,
    artUrl: null,
    releaseYear: 2000,
    addedAt: 0,
    source: 'manual',
    dedupKey: makeDedupKey(artist, title),
    rating: 1500,
    ratingDeviation: 350,
    volatility: 0.06,
    comparisonCount: 0,
    review: '',
    personalScore,
    reviewUpdatedAt: null,
    isPublic: true,
    hasStoredVisibility: true,
  }
}

/** Comparisons consistent with `order`, best first, repeated `rounds` times. */
function consistentLog(order: string[], rounds: number): Comparison[] {
  const out: Comparison[] = []
  for (let r = 0; r < rounds; r += 1) {
    for (let i = 0; i < order.length; i += 1) {
      for (let j = i + 1; j < order.length; j += 1) {
        out.push(comparison(order[i], order[j], order[i]))
      }
    }
  }
  return out
}

describe('artist affinity', () => {
  const albums = [
    album('a1', 'Loved Artist', 'First'),
    album('a2', 'Loved Artist', 'Second'),
    album('b1', 'Middling Artist', 'Third'),
    album('c1', 'Disliked Artist', 'Fourth'),
    album('c2', 'Disliked Artist', 'Fifth'),
  ]
  const order = ['a1', 'a2', 'b1', 'c1', 'c2']

  it('ranks artists by how well their albums actually do', () => {
    const ratings = computeRatings(order, consistentLog(order, 4))
    const ranked = artistAffinities(albums, ratings)

    expect(ranked.map((a) => a.artist)).toEqual([
      'Loved Artist',
      'Middling Artist',
      'Disliked Artist',
    ])
    expect(ranked[0].affinity).toBeGreaterThan(0)
    expect(ranked[2].affinity).toBeLessThan(0)
  })

  it('names the artist’s best album, which is what a suggestion cites', () => {
    const ratings = computeRatings(order, consistentLog(order, 4))
    const loved = artistAffinities(albums, ratings)[0]
    expect(loved.best.id).toBe('a1')
    expect(loved.albums).toHaveLength(2)
  })

  it('ignores albums with too little evidence behind them', () => {
    const withNewcomer = [...albums, album('new', 'Unproven Artist', 'Brand New')]
    const log = consistentLog(order, 4)
    // A single win is not enough to call an artist a favourite.
    log.push(comparison('new', 'c2', 'new'))

    const ratings = computeRatings([...order, 'new'], log)
    const artists = artistAffinities(withNewcomer, ratings).map((a) => a.artist)
    expect(artists).not.toContain('Unproven Artist')
  })

  it('weights a well-established album above a barely-tested one', () => {
    // Two artists at similar ratings, one with far more evidence. The confident
    // one should carry more weight, which is what stops a lucky newcomer from
    // topping the list.
    const ratings = computeRatings(order, consistentLog(order, 4))
    const ranked = artistAffinities(albums, ratings)
    const loved = ranked.find((a) => a.artist === 'Loved Artist')!
    const middling = ranked.find((a) => a.artist === 'Middling Artist')!
    expect(loved.confidence).toBeGreaterThan(middling.confidence)
  })

  it('returns nothing when no album has been compared', () => {
    expect(artistAffinities(albums, computeRatings(order, []))).toEqual([])
  })
})

describe('score versus revealed preference', () => {
  it('surfaces the albums where the two most disagree', () => {
    const order = ['x1', 'x2', 'x3', 'x4']
    const albums = [
      // Ranked top by comparison, but scored lowest by hand.
      album('x1', 'A', 'Top by choice', 6),
      album('x2', 'B', 'Second', 8),
      album('x3', 'C', 'Third', 9),
      // Ranked last, scored highest.
      album('x4', 'D', 'Bottom by choice', 10),
    ]
    const ratings = computeRatings(order, consistentLog(order, 4))
    const found = disagreements(albums, ratings)

    expect(found[0].album.id).toBe('x1')
    // Ranked 1st by comparison, 4th by score: it does better than you say.
    expect(found[0].rankByComparison).toBe(1)
    expect(found[0].rankByScore).toBe(4)
    expect(found[0].gap).toBe(-3)
  })

  it('ignores albums with no score of their own', () => {
    const order = ['x1', 'x2', 'x3']
    const albums = [album('x1', 'A', 'One', 9), album('x2', 'B', 'Two'), album('x3', 'C', 'Three', 5)]
    const ratings = computeRatings(order, consistentLog(order, 4))
    expect(disagreements(albums, ratings).every((d) => d.album.id !== 'x2')).toBe(true)
  })

  it('reports nothing when score and ranking agree', () => {
    const order = ['x1', 'x2', 'x3']
    const albums = [
      album('x1', 'A', 'One', 10),
      album('x2', 'B', 'Two', 8),
      album('x3', 'C', 'Three', 6),
    ]
    const ratings = computeRatings(order, consistentLog(order, 4))
    expect(disagreements(albums, ratings)).toEqual([])
  })
})

describe('mind changers', () => {
  it('surfaces the album you contradicted yourself on', () => {
    const order = ['s1', 's2', 's3', 's4']
    const albums = order.map((id, i) => album(id, `Artist ${i}`, `Album ${i}`))

    // A consistent ranking, except s3 keeps beating s1 despite ending up below
    // it — exactly the "I keep changing my mind" pattern.
    const log = consistentLog(order, 5)
    for (let i = 0; i < 4; i += 1) log.push(comparison('s3', 's1', 's3'))

    const ratings = computeRatings(order, log)
    const found = mindChangers(albums, ratings, log, 4)

    expect(found.map((m) => m.album.id)).toContain('s3')
    expect(found.find((m) => m.album.id === 's3')!.upsets).toBeGreaterThan(0)
  })

  it('says nothing when every result agrees with the final order', () => {
    const order = ['s1', 's2', 's3', 's4']
    const albums = order.map((id, i) => album(id, `Artist ${i}`, `Album ${i}`))
    const log = consistentLog(order, 5)

    // Perfectly consistent judging: claiming the user wavers would be a lie.
    expect(mindChangers(albums, computeRatings(order, log), log)).toEqual([])
  })

  it('ignores ties and skips, which are not contradictions', () => {
    const order = ['s1', 's2', 's3', 's4']
    const albums = order.map((id, i) => album(id, `Artist ${i}`, `Album ${i}`))
    const log = consistentLog(order, 5)
    for (let i = 0; i < 6; i += 1) {
      log.push(comparison('s1', 's4', 'tie'), comparison('s2', 's3', 'skip'))
    }

    expect(mindChangers(albums, computeRatings(order, log), log)).toEqual([])
  })
})

describe('stale favourites', () => {
  it('picks well-rated albums that have not come up lately', () => {
    const order = ['t1', 't2', 't3', 't4']
    const albums = order.map((id, i) => album(id, `Artist ${i}`, `Album ${i}`))
    const log = consistentLog(order, 4)
    // t2 and t3 keep appearing; t1 has not been seen since the initial rounds.
    for (let i = 0; i < 20; i += 1) log.push(comparison('t2', 't3', 't2'))

    const ratings = computeRatings(order, log)
    const stale = staleFavourites(albums, ratings, log, 2).map((a) => a.id)
    expect(stale).toContain('t1')
    expect(stale).not.toContain('t2')
  })
})

describe('rating history', () => {
  it('tracks an album climbing as evidence accumulates', () => {
    const order = ['h1', 'h2', 'h3', 'h4']
    const log = consistentLog(order, 6)
    const history = ratingHistory('h1', order, log)

    expect(history.length).toBeGreaterThan(2)
    expect(history[history.length - 1].rating).toBeGreaterThan(history[0].rating)
    // Replay is exact, so the final point must equal a straight computation.
    const finalTable = computeRatings(order, log)
    expect(history[history.length - 1].rating).toBeCloseTo(finalTable.get('h1')!.rating, 9)
  })

  it('is empty when there is nothing logged', () => {
    expect(ratingHistory('h1', ['h1', 'h2'], [])).toEqual([])
  })
})
