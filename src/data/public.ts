import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from './firebase'
import { type Album, normaliseAlbum } from './types'

/**
 * The public rankings feed.
 *
 * Read without signing in, so the query has to match the Firestore rule exactly:
 * the rule permits a read only when `isPublic == true`, and Firestore evaluates
 * that against the *query*, not the results. A broader query is rejected
 * outright rather than filtered — which is what makes this safe.
 *
 * Ratings come from the cached fields on each album document rather than from a
 * replay, because the comparison log stays owner-only. That cache is written
 * back every time the owner loads the app, so the public page trails the true
 * ranking by at most one visit.
 */
export async function fetchPublicAlbums(): Promise<Album[]> {
  const snap = await getDocs(
    query(collection(db, 'albums'), where('isPublic', '==', true)),
  )
  return snap.docs.map((d) => normaliseAlbum(d.id, d.data()))
}
