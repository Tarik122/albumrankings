import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { auth } from './firebase'
import { ownerUid } from '../config'

/**
 * Single-user auth. There is no account system here — Firebase Auth exists
 * only to produce a UID that the Firestore rules can be pinned to. Anyone else
 * signing in gets a valid Firebase session and is then refused by the rules,
 * which is the point: the lock lives in the database, not in this file.
 */

const provider = new GoogleAuthProvider()

export function watchAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb)
}

export async function signIn(): Promise<User> {
  const credential = await signInWithPopup(auth, provider)
  return credential.user
}

export function signOutOwner(): Promise<void> {
  return signOut(auth)
}

/**
 * Whether this session is the owner. Purely a UI convenience so we can show a
 * useful message instead of a wall of permission-denied errors — the actual
 * enforcement is in firestore.rules and cannot be bypassed from the client.
 */
export function isOwner(user: User | null): boolean {
  if (!user) return false
  // Before the owner UID is configured, the first signed-in user is treated as
  // the owner so the app can show them the UID they need to paste into config.
  if (!ownerUid) return true
  return user.uid === ownerUid
}

export function ownerConfigured(): boolean {
  return ownerUid.length > 0
}
