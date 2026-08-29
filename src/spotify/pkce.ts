/**
 * PKCE helpers.
 *
 * Authorization Code with PKCE is the only Spotify flow that works here: a
 * static GitHub Pages site has nowhere to keep a client secret, and the
 * implicit grant is both deprecated and refresh-token-less. PKCE substitutes a
 * per-request proof for the secret, so nothing confidential ever ships in the
 * bundle.
 */

const VERIFIER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

/** RFC 7636 allows 43–128 characters from the unreserved set. */
export function createVerifier(length = 96): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let out = ''
  for (const byte of bytes) out += VERIFIER_CHARS[byte % VERIFIER_CHARS.length]
  return out
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

export function createState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(16)))
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
