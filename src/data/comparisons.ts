import { addDoc, collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from './firebase'
import type { Comparison } from './types'

const COLLECTION = 'comparisons'

/**
 * The append-only comparison log.
 *
 * Nothing in this module updates or deletes. Ratings are a pure function of
 * this log, so preserving it intact is what allows the algorithm to be retuned
 * later and the whole history re-scored. The Firestore rules enforce the same
 * thing server-side.
 */

export function listenComparisons(
  onChange: (comparisons: Comparison[]) => void,
  onError: (e: Error) => void,
): () => void {
  const q = query(collection(db, COLLECTION), orderBy('comparedAt', 'asc'))
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Comparison)),
    onError,
  )
}

export async function recordComparison(
  albumA: string,
  albumB: string,
  winner: string | 'tie' | 'skip',
): Promise<Comparison> {
  const record = { albumA, albumB, winner, comparedAt: Date.now() }
  const ref = await addDoc(collection(db, COLLECTION), record)
  return { id: ref.id, ...record }
}
