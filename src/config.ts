/**
 * Configuration, all of it from Vite env vars.
 *
 * None of these are secrets. GitHub Pages serves a public bundle, so the
 * Firebase config and the Spotify client id are visible to anyone who looks —
 * that is expected and fine. Security comes from the Firestore rules pinning
 * every read and write to a single owner UID, and from Spotify's PKCE flow
 * needing no client secret. See firestore.rules and SETUP.md.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill it in — see SETUP.md.`,
    )
  }
  return value
}

export const firebaseConfig = {
  apiKey: required('VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: required('VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: required('VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: required('VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID),
}

/**
 * The one account allowed to read or write. Empty on first run — sign in once,
 * copy the UID the app shows you, then set this and the matching Firestore rule.
 */
export const ownerUid: string = import.meta.env.VITE_OWNER_UID ?? ''

export const spotifyClientId: string = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? ''

/**
 * Spotify requires an exact redirect-URI match. In dev this must be the
 * loopback IP: `localhost` is rejected under the current developer rules.
 */
export const spotifyRedirectUri: string = new URL(
  import.meta.env.BASE_URL,
  window.location.origin,
).toString()

export const spotifyScopes = [
  'user-top-read',
  'user-read-recently-played',
  // Saved albums. Added after the first release, so an existing connection has
  // to be re-authorised before the saved-albums import will work — the app
  // detects the missing scope and says so rather than failing with a bare 403.
  'user-library-read',
] as const
