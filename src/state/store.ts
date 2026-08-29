/**
 * App state: the live library, the live comparison log, and the ratings
 * derived from them.
 *
 * Ratings are recomputed from the whole log whenever either changes. That
 * sounds expensive and isn't: a few thousand comparisons over a few hundred
 * albums replays in well under a frame, and doing it this way means the
 * displayed ranking is always exactly what the log implies — no drift between
 * a stored number and the history behind it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { backfillPublicFlag, listenAlbums, persistRatings } from '../data/albums'
import { listenComparisons } from '../data/comparisons'
import type { Album, Comparison } from '../data/types'
import { DEFAULT_ENGINE_CONFIG, computeRatings, type RatingTable } from '../rating/engine'
import { isOwner } from '../data/auth'

export interface LibraryState {
  albums: Album[]
  comparisons: Comparison[]
  ratings: RatingTable
  loading: boolean
  error: string | null
}

export function useLibrary(user: User | null): LibraryState {
  const [albums, setAlbums] = useState<Album[]>([])
  const [comparisons, setComparisons] = useState<Comparison[]>([])
  const [loaded, setLoaded] = useState({ albums: false, comparisons: false })
  const [error, setError] = useState<string | null>(null)

  const allowed = isOwner(user)

  useEffect(() => {
    if (!allowed) {
      setAlbums([])
      setComparisons([])
      setLoaded({ albums: false, comparisons: false })
      return
    }

    setError(null)
    const stopAlbums = listenAlbums(
      (next) => {
        setAlbums(next)
        setLoaded((l) => ({ ...l, albums: true }))
      },
      (e) => setError(describe(e)),
    )
    const stopComparisons = listenComparisons(
      (next) => {
        setComparisons(next)
        setLoaded((l) => ({ ...l, comparisons: true }))
      },
      (e) => setError(describe(e)),
    )

    return () => {
      stopAlbums()
      stopComparisons()
    }
  }, [allowed])

  const ratings = useMemo(
    () => computeRatings(albums.map((a) => a.id), comparisons, DEFAULT_ENGINE_CONFIG),
    [albums, comparisons],
  )

  // Mirror the computed ratings back onto the album documents. Best-effort:
  // the cache being stale is harmless, since nothing reads it as authoritative.
  const syncing = useRef(false)
  useEffect(() => {
    if (!allowed || !loaded.albums || !loaded.comparisons || syncing.current) return
    syncing.current = true
    Promise.all([persistRatings(albums, ratings), backfillPublicFlag(albums)])
      .catch(() => undefined)
      .finally(() => {
        syncing.current = false
      })
  }, [allowed, loaded.albums, loaded.comparisons, albums, ratings])

  return {
    albums,
    comparisons,
    ratings,
    loading: allowed && !(loaded.albums && loaded.comparisons),
    error,
  }
}

function describe(e: Error): string {
  if (e.message.includes('permission-denied') || e.message.includes('Missing or insufficient')) {
    return (
      'Firestore refused the request. Check that firestore.rules has your UID ' +
      'and that the rules are deployed — see SETUP.md step 5.'
    )
  }
  return e.message
}

/** Look up albums by id without a linear scan on every render. */
export function useAlbumIndex(albums: Album[]): Map<string, Album> {
  return useMemo(() => new Map(albums.map((a) => [a.id, a])), [albums])
}

/** Stable callback helper for the view components. */
export function useAsyncAction(): [
  boolean,
  string | null,
  (fn: () => Promise<unknown>) => Promise<void>,
] {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  return [busy, error, run]
}
