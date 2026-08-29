// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Stubbed so the component test never reaches Firestore. Everything else —
// matchmaking, the rating maths, the pending-write buffer — is the real thing.
const recordComparison = vi.fn()
vi.mock('../data/comparisons', () => ({
  recordComparison: (...args: unknown[]) => recordComparison(...args),
}))

const { CompareView } = await import('./CompareView')
const { computeRatings } = await import('../rating/engine')
const { makeDedupKey } = await import('../data/types')
type Album = import('../data/types').Album
type Comparison = import('../data/types').Comparison

function album(id: string, title: string): Album {
  return {
    id,
    title,
    artist: `Artist ${id}`,
    spotifyAlbumId: null,
    artUrl: null,
    releaseYear: 2001,
    addedAt: 0,
    source: 'manual',
    dedupKey: makeDedupKey(`Artist ${id}`, title),
    rating: 1500,
    ratingDeviation: 350,
    volatility: 0.06,
    comparisonCount: 0,
    review: '',
    personalScore: null,
    reviewUpdatedAt: null,
    isPublic: true,
    hasStoredVisibility: true,
  }
}

function renderCompare(albums: Album[], comparisons: Comparison[] = []) {
  const ratings = computeRatings(albums.map((a) => a.id), comparisons)
  const index = new Map(albums.map((a) => [a.id, a]))
  return render(
    <CompareView albums={albums} comparisons={comparisons} ratings={ratings} index={index} />,
  )
}

const LIBRARY = [album('one', 'First Album'), album('two', 'Second Album')]

beforeEach(() => {
  recordComparison.mockReset()
  recordComparison.mockImplementation(
    async (albumA: string, albumB: string, winner: string) => ({
      id: `c${Math.random()}`,
      albumA,
      albumB,
      winner,
      comparedAt: Date.now(),
    }),
  )
})

afterEach(cleanup)

describe('CompareView', () => {
  it('asks for albums when there are not enough to compare', () => {
    renderCompare([album('one', 'Only Album')])
    expect(screen.getByText(/add at least two albums/i)).toBeInTheDocument()
  })

  it('offers a pair with both a tie and a skip available', () => {
    renderCompare(LIBRARY)
    expect(card('First Album')).toBeInTheDocument()
    expect(card('Second Album')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /too close to call/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument()
  })

  it('records the album that was clicked as the winner', async () => {
    const user = userEvent.setup()
    renderCompare(LIBRARY)

    await user.click(card('First Album'))

    await waitFor(() => expect(recordComparison).toHaveBeenCalledTimes(1))
    const [a, b, winner] = recordComparison.mock.calls[0]
    expect([a, b].sort()).toEqual(['one', 'two'])
    expect(winner).toBe('one')
  })

  it('distinguishes a tie from a skip in the log', async () => {
    const user = userEvent.setup()
    renderCompare(LIBRARY)

    await user.click(screen.getByRole('button', { name: /too close to call/i }))
    await waitFor(() => expect(recordComparison).toHaveBeenCalledTimes(1))
    expect(recordComparison.mock.calls[0][2]).toBe('tie')

    await user.click(screen.getByRole('button', { name: /skip/i }))
    await waitFor(() => expect(recordComparison).toHaveBeenCalledTimes(2))
    expect(recordComparison.mock.calls[1][2]).toBe('skip')
  })

  it('supports keyboard voting', async () => {
    const user = userEvent.setup()
    renderCompare(LIBRARY)

    await user.keyboard('1')
    await waitFor(() => expect(recordComparison).toHaveBeenCalledTimes(1))
    expect(recordComparison.mock.calls[0][2]).toBe(recordComparison.mock.calls[0][0])

    await user.keyboard('t')
    await waitFor(() => expect(recordComparison).toHaveBeenCalledTimes(2))
    expect(recordComparison.mock.calls[1][2]).toBe('tie')

    await user.keyboard('s')
    await waitFor(() => expect(recordComparison).toHaveBeenCalledTimes(3))
    expect(recordComparison.mock.calls[2][2]).toBe('skip')
  })

  it('advances to a new pair rather than re-asking the one just judged', async () => {
    const user = userEvent.setup()
    // Four albums, so a genuinely different pair is available afterwards. The
    // parent does not re-render with the new comparison here, which is exactly
    // the race the local pending buffer exists to cover.
    const four = [
      album('one', 'First Album'),
      album('two', 'Second Album'),
      album('three', 'Third Album'),
      album('four', 'Fourth Album'),
    ]
    renderCompare(four)

    const firstPair = shownPair(four)
    await user.click(card(firstPair[0]))
    await waitFor(() => expect(recordComparison).toHaveBeenCalledTimes(1))

    await waitFor(() => expect(shownPair(four).join('|')).not.toBe(firstPair.join('|')))
  })

  it('counts the session as it goes', async () => {
    const user = userEvent.setup()
    renderCompare(LIBRARY)
    expect(screen.getByText(/0 this session/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /skip/i }))
    await waitFor(() => expect(screen.getByText(/1 this session/)).toBeInTheDocument())
  })

  it('surfaces a write failure instead of silently losing the vote', async () => {
    const user = userEvent.setup()
    recordComparison.mockRejectedValue(new Error('Firestore refused the request.'))
    renderCompare(LIBRARY)

    await user.click(screen.getByRole('button', { name: /skip/i }))
    await waitFor(() =>
      expect(screen.getByText(/firestore refused the request/i)).toBeInTheDocument(),
    )
  })
})

/** The comparison card for an album, addressed the way a user would see it. */
function card(title: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(title, 'i') })
}

/** The album titles currently offered, in a stable order. */
function shownPair(albums: Album[]): string[] {
  return albums
    .map((a) => a.title)
    .filter((title) => screen.queryAllByRole('button', { name: new RegExp(title, 'i') }).length > 0)
    .sort()
}
