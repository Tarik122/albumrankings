/**
 * Turning Spotify listening data into album suggestions.
 *
 * Spotify has no "top albums" endpoint, and several endpoints that would have
 * helped here (recommendations, related artists, audio features, new releases)
 * were withdrawn for apps registered under the current rules. What remains is
 * top *tracks* and recently-played *tracks* — so albums are inferred by rolling
 * tracks up to their parent album, which is what this module does.
 */

import { spotifyGet } from './api'
import type { NewAlbum } from '../data/albums'
import type { AlbumSource } from '../data/types'

/** Spotify's three windows: ~4 weeks, ~6 months, and several years. */
export const TIME_RANGES = ['short_term', 'medium_term', 'long_term'] as const
export type TimeRange = (typeof TIME_RANGES)[number]

export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  short_term: 'Last 4 weeks',
  medium_term: 'Last 6 months',
  long_term: 'All time',
}

interface SpotifyImage {
  url: string
  width: number | null
  height: number | null
}

interface SpotifySimplifiedAlbum {
  id: string
  name: string
  images: SpotifyImage[]
  release_date: string | null
  artists: { name: string }[]
  album_type: string
  total_tracks: number
}

interface SpotifyTrack {
  id: string
  name: string
  album: SpotifySimplifiedAlbum
}

interface Paged<T> {
  items: T[]
  total: number
}

/** An album inferred from listening data, with the evidence that surfaced it. */
export interface AlbumSuggestion extends NewAlbum {
  spotifyAlbumId: string
  /** Distinct tracks of this album seen in the source data. */
  trackCount: number
  /** Ranking weight — higher means stronger evidence you actually love it. */
  score: number
  /** Track names that produced the suggestion, for display. */
  tracks: string[]
}

/**
 * "Most listened" albums, approximated from top tracks.
 *
 * A track's contribution decays with its rank, so an album represented by your
 * #1 track outranks one represented by your #48. Multiple tracks from the same
 * album compound, which is the signal that separates an album you love from one
 * where a single song happened to catch on.
 */
export async function fetchTopAlbums(ranges: TimeRange[] = [...TIME_RANGES]): Promise<AlbumSuggestion[]> {
  const tally = new Map<string, AlbumSuggestion>()

  for (const range of ranges) {
    const page = await spotifyGet<Paged<SpotifyTrack>>(
      `/me/top/tracks?time_range=${range}&limit=50`,
    )
    page.items.forEach((track, index) => {
      // 1.0 for the top track down to ~0.5 for the 50th.
      const weight = 1 / (1 + index / 50)
      accumulate(tally, track, 'spotify-top', weight)
    })
  }

  return rank(tally)
}

/**
 * Albums from the last 50 plays. Spotify caps this endpoint at 50 items with no
 * deeper history, so this is a rolling window rather than a full play log —
 * check in regularly if you want to catch everything.
 */
export async function fetchRecentAlbums(): Promise<AlbumSuggestion[]> {
  const page = await spotifyGet<Paged<{ track: SpotifyTrack; played_at: string }>>(
    '/me/player/recently-played?limit=50',
  )
  const tally = new Map<string, AlbumSuggestion>()
  for (const play of page.items) {
    accumulate(tally, play.track, 'spotify-recent', 1)
  }
  return rank(tally)
}

/**
 * Album search. Spotify's `limit` now maxes out at 10, so this is built for
 * specific queries rather than browsing — pairing artist and album name in one
 * query works far better than either alone.
 */
export async function searchAlbums(queryText: string): Promise<AlbumSuggestion[]> {
  const trimmed = queryText.trim()
  if (!trimmed) return []
  const res = await spotifyGet<{ albums: Paged<SpotifySimplifiedAlbum> }>(
    `/search?type=album&limit=10&q=${encodeURIComponent(trimmed)}`,
  )
  return res.albums.items.map((album, index) => ({
    ...toNewAlbum(album, 'spotify-search'),
    spotifyAlbumId: album.id,
    trackCount: album.total_tracks,
    score: res.albums.items.length - index,
    tracks: [],
  }))
}

/**
 * Full detail for one album. The batch endpoint was removed, so this is
 * deliberately singular — callers enriching many albums should go through
 * `throttled` in api.ts rather than firing them all at once.
 */
export async function fetchAlbum(spotifyAlbumId: string): Promise<NewAlbum> {
  const album = await spotifyGet<SpotifySimplifiedAlbum>(`/albums/${spotifyAlbumId}`)
  return toNewAlbum(album, 'spotify-search')
}

function accumulate(
  tally: Map<string, AlbumSuggestion>,
  track: SpotifyTrack,
  source: AlbumSource,
  weight: number,
): void {
  const album = track.album
  if (!album?.id) return
  // Singles and one-track releases are not albums for ranking purposes; they
  // would flood the library with entries that are really just songs.
  if (album.album_type === 'single' || album.total_tracks < 3) return

  const existing = tally.get(album.id)
  if (existing) {
    existing.score += weight
    if (!existing.tracks.includes(track.name)) {
      existing.tracks.push(track.name)
      existing.trackCount += 1
    }
    return
  }

  tally.set(album.id, {
    ...toNewAlbum(album, source),
    spotifyAlbumId: album.id,
    trackCount: 1,
    score: weight,
    tracks: [track.name],
  })
}

function rank(tally: Map<string, AlbumSuggestion>): AlbumSuggestion[] {
  return [...tally.values()].sort((a, b) => b.score - a.score || b.trackCount - a.trackCount)
}

function toNewAlbum(album: SpotifySimplifiedAlbum, source: AlbumSource): NewAlbum {
  return {
    title: album.name,
    artist: album.artists.map((a) => a.name).join(', '),
    spotifyAlbumId: album.id,
    artUrl: pickImage(album.images),
    releaseYear: album.release_date ? Number(album.release_date.slice(0, 4)) : null,
    source,
  }
}

/** Prefer a mid-size image: the 640px original is wasteful for a grid tile. */
function pickImage(images: SpotifyImage[]): string | null {
  if (!images?.length) return null
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  return (sorted.find((i) => (i.width ?? 0) >= 300) ?? sorted[sorted.length - 1]).url
}
