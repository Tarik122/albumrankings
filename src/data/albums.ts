import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import {
  NEW_ALBUM_DEFAULTS,
  type Album,
  type AlbumSource,
  makeDedupKey,
  normaliseAlbum,
} from './types'
import { DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOLATILITY } from '../rating/glicko2'
import type { RatingTable } from '../rating/engine'

const COLLECTION = 'albums'

export interface NewAlbum {
  title: string
  artist: string
  spotifyAlbumId?: string | null
  artUrl?: string | null
  releaseYear?: number | null
  source: AlbumSource
}

export function listenAlbums(
  onChange: (albums: Album[]) => void,
  onError: (e: Error) => void,
): () => void {
  const q = query(collection(db, COLLECTION), orderBy('addedAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => normaliseAlbum(d.id, d.data()))),
    onError,
  )
}

/**
 * Add an album, unless we already have it.
 *
 * Deduplication is checked against the in-memory library rather than by query,
 * because we already hold every album via the live snapshot and the whole
 * library is small enough to keep resident. Returns the existing album when
 * one matches, so callers can report "already in your library" instead of
 * silently creating a twin and splitting its comparison history.
 */
export async function addAlbum(input: NewAlbum, existing: Album[]): Promise<Album> {
  const duplicate = findDuplicate(input, existing)
  if (duplicate) {
    // A manual entry we now have a Spotify id for is worth enriching in place.
    // Its doc id never changes, so every comparison already logged survives.
    if (!duplicate.spotifyAlbumId && input.spotifyAlbumId) {
      await updateDoc(doc(db, COLLECTION, duplicate.id), {
        spotifyAlbumId: input.spotifyAlbumId,
        artUrl: input.artUrl ?? duplicate.artUrl,
        releaseYear: input.releaseYear ?? duplicate.releaseYear,
      })
    }
    return duplicate
  }

  const record = {
    title: input.title.trim(),
    artist: input.artist.trim(),
    spotifyAlbumId: input.spotifyAlbumId ?? null,
    artUrl: input.artUrl ?? null,
    releaseYear: input.releaseYear ?? null,
    addedAt: Date.now(),
    source: input.source,
    dedupKey: makeDedupKey(input.artist, input.title),
    rating: DEFAULT_RATING,
    ratingDeviation: DEFAULT_RD,
    volatility: DEFAULT_VOLATILITY,
    comparisonCount: 0,
    ...NEW_ALBUM_DEFAULTS,
  }

  const ref = await addDoc(collection(db, COLLECTION), record)
  return { id: ref.id, ...record, hasStoredVisibility: true }
}

/** Match on Spotify id first, then on the normalised artist + title key. */
export function findDuplicate(
  input: Pick<NewAlbum, 'title' | 'artist' | 'spotifyAlbumId'>,
  existing: Album[],
): Album | null {
  if (input.spotifyAlbumId) {
    const bySpotify = existing.find((a) => a.spotifyAlbumId === input.spotifyAlbumId)
    if (bySpotify) return bySpotify
  }
  const key = makeDedupKey(input.artist, input.title)
  return existing.find((a) => a.dedupKey === key) ?? null
}

export function deleteAlbum(id: string): Promise<void> {
  return deleteDoc(doc(db, COLLECTION, id))
}

/**
 * Write computed ratings back onto the album documents.
 *
 * This is a cache, never the authority — the comparison log is. It exists so a
 * cold start can render a leaderboard before the replay finishes, and so the
 * numbers are legible if you open Firestore directly. Only changed documents
 * are written, so an unchanged replay costs nothing.
 */
export async function persistRatings(albums: Album[], ratings: RatingTable): Promise<number> {
  const stale = albums.filter((album) => {
    const computed = ratings.get(album.id)
    if (!computed) return false
    return (
      Math.abs(computed.rating - album.rating) > 0.01 ||
      Math.abs(computed.ratingDeviation - album.ratingDeviation) > 0.01 ||
      Math.abs(computed.volatility - album.volatility) > 1e-9 ||
      computed.comparisonCount !== album.comparisonCount
    )
  })

  // Firestore caps a batch at 500 writes.
  const CHUNK = 400
  for (let i = 0; i < stale.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const album of stale.slice(i, i + CHUNK)) {
      const computed = ratings.get(album.id)!
      batch.update(doc(db, COLLECTION, album.id), {
        rating: computed.rating,
        ratingDeviation: computed.ratingDeviation,
        volatility: computed.volatility,
        comparisonCount: computed.comparisonCount,
      })
    }
    await batch.commit()
  }

  return stale.length
}

/** What the album editor can change. Everything here is outside the rating maths. */
export interface AlbumMeta {
  review: string
  personalScore: number | null
  isPublic: boolean
}

export function updateAlbumMeta(id: string, meta: AlbumMeta): Promise<void> {
  return updateDoc(doc(db, COLLECTION, id), {
    review: meta.review,
    personalScore: meta.personalScore,
    isPublic: meta.isPublic,
    reviewUpdatedAt: Date.now(),
  })
}

/**
 * Write `isPublic` onto albums created before the field existed.
 *
 * Unlike the other new fields this cannot be defaulted on read: the Firestore
 * rules match on the *stored* value, so an album without the field is invisible
 * to the public page no matter what the client thinks it is. Runs once; after
 * the first pass there is nothing left to find.
 */
export async function backfillPublicFlag(albums: Album[]): Promise<number> {
  const missing = albums.filter((a) => !a.hasStoredVisibility)
  const CHUNK = 400
  for (let i = 0; i < missing.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const album of missing.slice(i, i + CHUNK)) {
      batch.update(doc(db, COLLECTION, album.id), { isPublic: true })
    }
    await batch.commit()
  }
  return missing.length
}
