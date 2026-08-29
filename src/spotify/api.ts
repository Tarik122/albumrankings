/**
 * Thin Spotify Web API client: bearer token, one retry on 401, and honest
 * handling of 429.
 *
 * Rate limiting matters more here than it might look. The batch "several
 * albums" endpoint no longer exists, so enriching a library means one
 * `/albums/{id}` call per album — a hundred albums is a hundred requests, and
 * blowing through a 429 would get the whole app throttled.
 */

import { getAccessToken } from './auth'

const BASE = 'https://api.spotify.com/v1'

export class SpotifyError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function spotifyGet<T>(path: string, attempt = 0): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.ok) return res.json() as Promise<T>

  if (res.status === 429 && attempt < 3) {
    // Spotify's Retry-After is in seconds. Respect it exactly; guessing shorter
    // is how an app earns a longer ban.
    const wait = Number(res.headers.get('Retry-After') ?? '2')
    await sleep((Number.isFinite(wait) ? wait : 2) * 1000)
    return spotifyGet<T>(path, attempt + 1)
  }

  if (res.status === 401 && attempt < 1) {
    // getAccessToken refreshes on expiry, so a 401 here means the token was
    // rejected for another reason. One retry picks up a freshly minted token.
    return spotifyGet<T>(path, attempt + 1)
  }

  const detail = await res.text().catch(() => '')
  throw new SpotifyError(describe(res.status, detail), res.status)
}

function describe(status: number, detail: string): string {
  if (status === 403) {
    return (
      'Spotify returned 403. Under Developer Mode your account must be listed ' +
      'in the app’s user management page and must be Premium. See SETUP.md step 6.'
    )
  }
  if (status === 429) return 'Spotify rate limit hit. Try again in a minute.'
  return `Spotify request failed (${status}). ${detail}`.trim()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Run tasks with a small concurrency cap, to stay well clear of 429s. */
export async function throttled<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency = 3,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  return results
}
