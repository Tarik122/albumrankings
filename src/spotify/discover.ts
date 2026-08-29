/**
 * Turning taste into things to listen to.
 *
 * Spotify's own recommendation machinery is not available to apps registered
 * under the current developer rules — `/recommendations`, `/related-artists`
 * and `/audio-features` were all withdrawn. What remains is search and the
 * catalogue, so recommendations here are assembled rather than requested:
 *
 *   1. Gaps — records by artists you already rank highly that you do not have.
 *   2. Genre neighbours — artists sharing the genres your favourites sit in.
 *
 * The first is the reliable one, and it is built only on `/search`. The second
 * needs artist genre data and is treated as best-effort throughout.
 */

import { SpotifyError, spotifyGet, throttled } from './api'
import type { AlbumSuggestion } from './import'
import type { NewAlbum } from '../data/albums'
import type { Album } from '../data/types'
import { makeDedupKey } from '../data/types'
import type { ArtistAffinity } from '../rating/insights'

interface SpotifyImage {
  url: string
  width: number | null
}

interface SimplifiedAlbum {
  id: string
  name: string
  images: SpotifyImage[]
  release_date: string | null
  artists: { id: string; name: string }[]
  total_tracks: number
}

interface FullArtist {
  id: string
  name: string
  genres: string[]
}

export interface Recommendation extends AlbumSuggestion {
  /** Plain-language reason, shown to the user. Never a bare relevance number. */
  reason: string
}

const MIN_TRACKS = 3

/**
 * Albums by artists you rank highly that are missing from your library.
 *
 * The most defensible recommendation available here: it makes no claim about
 * similarity, only that you demonstrably rate this artist and have not heard
 * this record. Uses album search, which is capped at 10 results per query, so
 * it queries per artist rather than paging.
 */
export async function findArtistGaps(
  affinities: ArtistAffinity[],
  existing: Album[],
  artistLimit = 12,
): Promise<Recommendation[]> {
  const have = new Set(existing.map((a) => a.dedupKey))
  const haveSpotifyIds = new Set(existing.map((a) => a.spotifyAlbumId).filter(Boolean))

  const top = affinities.filter((a) => a.affinity > 0).slice(0, artistLimit)

  const perArtist = await throttled(top, async (affinity) => {
    const query = `artist:${JSON.stringify(affinity.artist)}`
    let found: SimplifiedAlbum[]
    try {
      const res = await spotifyGet<{ albums: { items: SimplifiedAlbum[] } }>(
        `/search?type=album&limit=10&q=${encodeURIComponent(query)}`,
      )
      found = res.albums.items
    } catch {
      // One artist failing must not sink the whole panel.
      return []
    }

    return found
      .filter((album) => {
        if (album.total_tracks < MIN_TRACKS) return false
        if (haveSpotifyIds.has(album.id)) return false
        const artist = album.artists.map((x) => x.name).join(', ')
        if (have.has(makeDedupKey(artist, album.name))) return false
        // Search on artist: is fuzzy; keep only records actually by them.
        return album.artists.some(
          (x) => x.name.trim().toLowerCase() === affinity.artist.trim().toLowerCase(),
        )
      })
      .map((album) => ({
        ...toSuggestion(album),
        reason: `You rank ${affinity.best.title} highly and don't have this one`,
      }))
  })

  return dedupe(perArtist.flat())
}

/**
 * Artists whose genres overlap with the ones your favourites sit in.
 *
 * Best-effort. It needs per-artist genre data, and if that is unavailable the
 * caller gets an empty list and a reason rather than an exception — this is the
 * part of the recommender most exposed to Spotify's API changes.
 */
export async function findGenreNeighbours(
  affinities: ArtistAffinity[],
  existing: Album[],
  limit = 20,
): Promise<{ results: Recommendation[]; note: string | null }> {
  const seeds = affinities.filter((a) => a.affinity > 0).slice(0, 8)
  const seedIds = seeds
    .map((a) => a.best.spotifyAlbumId)
    .filter((id): id is string => Boolean(id))

  if (seedIds.length === 0) {
    return {
      results: [],
      note: 'Your top albums have no Spotify link yet, so there is nothing to read genres from.',
    }
  }

  // Album → artist id → artist genres. Two hops, because album objects carry
  // only simplified artists with no genre information.
  const genreWeight = new Map<string, number>()
  const knownArtistIds = new Set<string>()
  let lookupFailed = false

  await throttled(seedIds.slice(0, 8), async (albumId) => {
    try {
      const album = await spotifyGet<SimplifiedAlbum>(`/albums/${albumId}`)
      const artistId = album.artists[0]?.id
      if (!artistId) return
      knownArtistIds.add(artistId)
      const artist = await spotifyGet<FullArtist>(`/artists/${artistId}`)
      for (const genre of artist.genres ?? []) {
        genreWeight.set(genre, (genreWeight.get(genre) ?? 0) + 1)
      }
    } catch (e) {
      if (e instanceof SpotifyError && e.status === 404) return
      lookupFailed = true
    }
  })

  if (genreWeight.size === 0) {
    return {
      results: [],
      note: lookupFailed
        ? 'Spotify would not return genre data for your top artists, so this suggestion type is unavailable.'
        : 'Spotify lists no genres for your top artists, so there is nothing to expand from.',
    }
  }

  const topGenres = [...genreWeight.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([genre]) => genre)

  const have = new Set(existing.map((a) => a.dedupKey))
  const haveSpotifyIds = new Set(existing.map((a) => a.spotifyAlbumId).filter(Boolean))
  const haveArtists = new Set(existing.map((a) => a.artist.trim().toLowerCase()))

  const perGenre = await throttled(topGenres, async (genre) => {
    let artists: FullArtist[]
    try {
      const res = await spotifyGet<{ artists: { items: FullArtist[] } }>(
        `/search?type=artist&limit=10&q=${encodeURIComponent(`genre:"${genre}"`)}`,
      )
      artists = res.artists.items
    } catch {
      return []
    }

    const fresh = artists
      .filter((a) => !knownArtistIds.has(a.id) && !haveArtists.has(a.name.trim().toLowerCase()))
      .slice(0, 3)

    const albums = await throttled(fresh, async (artist) => {
      try {
        const res = await spotifyGet<{ items: SimplifiedAlbum[] }>(
          `/artists/${artist.id}/albums?include_groups=album&limit=3`,
        )
        return res.items
          .filter(
            (album) =>
              album.total_tracks >= MIN_TRACKS &&
              !haveSpotifyIds.has(album.id) &&
              !have.has(makeDedupKey(album.artists.map((x) => x.name).join(', '), album.name)),
          )
          .map((album) => ({
            ...toSuggestion(album),
            reason: `${genre} — the genre your favourites cluster in`,
          }))
      } catch {
        return []
      }
    })

    return albums.flat()
  })

  const results = dedupe(perGenre.flat()).slice(0, limit)
  return {
    results,
    note: results.length === 0 ? 'No new artists came back for those genres.' : null,
  }
}

function toSuggestion(album: SimplifiedAlbum): AlbumSuggestion & NewAlbum {
  return {
    title: album.name,
    artist: album.artists.map((a) => a.name).join(', '),
    spotifyAlbumId: album.id,
    artUrl: pickImage(album.images),
    releaseYear: album.release_date ? Number(album.release_date.slice(0, 4)) : null,
    source: 'spotify-search',
    trackCount: album.total_tracks,
    score: 0,
    tracks: [],
  }
}

function dedupe(items: Recommendation[]): Recommendation[] {
  const seen = new Set<string>()
  const out: Recommendation[] = []
  for (const item of items) {
    if (seen.has(item.spotifyAlbumId)) continue
    seen.add(item.spotifyAlbumId)
    out.push(item)
  }
  return out
}

function pickImage(images: SpotifyImage[]): string | null {
  if (!images?.length) return null
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  return (sorted.find((i) => (i.width ?? 0) >= 300) ?? sorted[sorted.length - 1]).url
}
