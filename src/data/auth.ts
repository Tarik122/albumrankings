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

/**
 * Sign in with Google.
 *
 * Deliberately a popup rather than a redirect. `signInWithRedirect` needs to
 * read a pending credential back from storage on the Firebase auth domain,
 * which Safari's tracking prevention partitions away whenever the app is served
 * from a different origin — which is exactly our case (github.io versus
 * firebaseapp.com). Fixing that would need a reverse proxy, and a static host
 * has nowhere to put one. The popup runs as a first-party context and works.
 *
 * The trade-off is that mobile Safari blocks popups unless they open directly
 * from a tap, so the errors below are worth naming precisely — otherwise this
 * fails on an iPad with nothing but "auth/popup-blocked" to go on.
 */
export async function signIn(): Promise<User> {
  try {
    const credential = await signInWithPopup(auth, provider)
    return credential.user
  } catch (e) {
    throw new Error(explainSignInFailure(e))
  }
}

function explainSignInFailure(e: unknown): string {
  const code = typeof e === 'object' && e && 'code' in e ? String(e.code) : ''
  switch (code) {
    case 'auth/popup-blocked':
    case 'auth/operation-not-supported-in-this-environment':
      return (
        'Your browser blocked the sign-in window. On iPad: Settings → Apps → ' +
        'Safari → turn off “Block Pop-ups”, then try again. On desktop, allow ' +
        'pop-ups for this site.'
      )
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'The sign-in window closed before it finished. Tap to try again.'
    case 'auth/unauthorized-domain':
      return (
        `${window.location.hostname} is not in your Firebase project’s authorised ` +
        'domains. Add it under Authentication → Settings → Authorized domains. ' +
        'See SETUP.md.'
      )
    case 'auth/network-request-failed':
      return 'Could not reach Firebase. Check your connection and try again.'
    default:
      return e instanceof Error ? e.message : String(e)
  }
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
