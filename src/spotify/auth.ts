/**
 * Spotify OAuth, entirely client-side.
 *
 * Access tokens last an hour, so refresh handling is not optional — without it
 * the app breaks in the middle of every real session. Spotify also rotates the
 * refresh token on some refreshes, so the response is always re-read for a new
 * one rather than assuming the original stays valid.
 */

import { spotifyClientId, spotifyRedirectUri, spotifyScopes } from '../config'
import { challengeFor, createState, createVerifier } from './pkce'

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'

const TOKEN_KEY = 'spotify.tokens'
const VERIFIER_KEY = 'spotify.verifier'
const STATE_KEY = 'spotify.state'

interface StoredTokens {
  accessToken: string
  refreshToken: string
  /** Epoch ms. */
  expiresAt: number
  /** Scopes Spotify actually granted, which may lag the scopes we now ask for. */
  scopes: string[]
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

export function isConnected(): boolean {
  return readTokens() !== null
}

/**
 * Whether the current connection covers a scope.
 *
 * Scopes are granted at authorisation time, so adding one to the app does not
 * retroactively grant it to an existing connection — that needs a fresh consent
 * round-trip. Checking up front lets the UI say "reconnect to enable this"
 * instead of letting the call fail with an opaque 403.
 */
export function hasScope(scope: string): boolean {
  const tokens = readTokens()
  if (!tokens) return false
  // A connection made before we recorded scopes has none stored. Assume the
  // scopes of that era rather than nagging for a reconnect that isn't needed.
  if (tokens.scopes.length === 0) {
    return scope === 'user-top-read' || scope === 'user-read-recently-played'
  }
  return tokens.scopes.includes(scope)
}

/** Scopes the app asks for but this connection does not have. */
export function missingScopes(): string[] {
  if (!isConnected()) return []
  return spotifyScopes.filter((scope) => !hasScope(scope))
}

export function disconnect(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/** Send the browser to Spotify's consent screen. */
export async function beginAuth(): Promise<void> {
  if (!spotifyClientId) {
    throw new Error('No Spotify client id configured — see SETUP.md step 6.')
  }

  const verifier = createVerifier()
  const state = createState()
  // sessionStorage, not localStorage: the verifier is single-use and should not
  // outlive the tab that started the flow.
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)

  const params = new URLSearchParams({
    client_id: spotifyClientId,
    response_type: 'code',
    redirect_uri: spotifyRedirectUri,
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
    state,
    scope: spotifyScopes.join(' '),
  })

  window.location.assign(`${AUTHORIZE_URL}?${params}`)
}

/**
 * Handle the redirect back from Spotify, if this page load is one.
 *
 * Returns true when a code was exchanged. The query string is cleared either
 * way so a refresh cannot replay a spent authorization code.
 */
export async function completeAuthIfRedirected(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')
  const state = params.get('state')
  if (!code && !error) return false

  const expectedState = sessionStorage.getItem(STATE_KEY)
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)
  clearQueryString()

  if (error) throw new Error(`Spotify refused the connection: ${error}`)
  if (!expectedState || state !== expectedState) {
    throw new Error('Spotify redirect state did not match — connection abandoned.')
  }
  if (!verifier) throw new Error('Lost the PKCE verifier — please connect again.')

  const tokens = await exchange({
    grant_type: 'authorization_code',
    code: code!,
    redirect_uri: spotifyRedirectUri,
    client_id: spotifyClientId,
    code_verifier: verifier,
  })
  storeTokens(tokens, null)
  return true
}

/**
 * A valid access token, refreshing first if the current one is close to
 * expiring. Concurrent callers share one refresh so an import that fires
 * several requests at once cannot spend the refresh token more than once.
 */
let inFlightRefresh: Promise<string> | null = null

export async function getAccessToken(): Promise<string> {
  const tokens = readTokens()
  if (!tokens) throw new Error('Not connected to Spotify.')

  // 60s of slack, so a token cannot expire between this check and the request.
  if (Date.now() < tokens.expiresAt - 60_000) return tokens.accessToken

  if (!inFlightRefresh) {
    inFlightRefresh = refresh(tokens).finally(() => {
      inFlightRefresh = null
    })
  }
  return inFlightRefresh
}

async function refresh(tokens: StoredTokens): Promise<string> {
  let refreshed: TokenResponse
  try {
    refreshed = await exchange({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: spotifyClientId,
    })
  } catch (e) {
    // A refresh token Spotify has revoked is unrecoverable; clear it so the UI
    // offers a reconnect rather than retrying forever.
    disconnect()
    throw e
  }
  storeTokens(refreshed, tokens)
  return refreshed.access_token
}

async function exchange(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Spotify token request failed (${res.status}). ${detail}`)
  }
  return res.json() as Promise<TokenResponse>
}

function storeTokens(
  response: TokenResponse,
  previous: Pick<StoredTokens, 'refreshToken' | 'scopes'> | null,
): void {
  const refreshToken = response.refresh_token ?? previous?.refreshToken
  if (!refreshToken) throw new Error('Spotify returned no refresh token.')
  const tokens: StoredTokens = {
    accessToken: response.access_token,
    refreshToken,
    expiresAt: Date.now() + response.expires_in * 1000,
    // A refresh response usually echoes the granted scopes; when it doesn't,
    // keep what we already knew rather than forgetting them.
    scopes: response.scope ? response.scope.split(' ').filter(Boolean) : (previous?.scopes ?? []),
  }
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens))
}

function readTokens(): StoredTokens | null {
  const raw = localStorage.getItem(TOKEN_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredTokens
    if (!parsed.accessToken || !parsed.refreshToken) return null
    return { ...parsed, scopes: Array.isArray(parsed.scopes) ? parsed.scopes : [] }
  } catch {
    return null
  }
}

function clearQueryString(): void {
  window.history.replaceState({}, '', window.location.pathname + window.location.hash)
}
