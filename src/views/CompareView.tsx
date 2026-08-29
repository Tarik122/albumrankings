import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ComparisonCard } from '../components/AlbumCard'
import { recordComparison } from '../data/comparisons'
import type { Album, Comparison } from '../data/types'
import type { RatingTable } from '../rating/engine'
import { selectPair, type Pair, type PairReason } from '../rating/matchmaking'
import { winProbability } from '../rating/glicko2'

interface Props {
  albums: Album[]
  comparisons: Comparison[]
  ratings: RatingTable
  index: Map<string, Album>
  /** When set, every pair involves this album until it is placed. */
  focusAlbumId?: string | null
  onEndFocus?: () => void
}

const REASON_LABEL: Record<PairReason, string> = {
  placement: 'Placing a new album',
  informative: 'Most informative pair right now',
  wildcard: 'Wildcard',
  audit: 'Checking an old verdict',
  focus: 'Placing this album',
}

/** Comparisons a focused session runs before the album counts as placed. */
const FOCUS_TARGET = 6

export function CompareView({
  albums,
  comparisons,
  ratings,
  index,
  focusAlbumId,
  onEndFocus,
}: Props) {
  const [pair, setPair] = useState<Pair | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionCount, setSessionCount] = useState(0)
  const [focusDone, setFocusDone] = useState(0)

  // Locally recorded comparisons, so a pair cannot be offered again in the
  // moment between writing it and the Firestore snapshot coming back.
  const pending = useRef<Comparison[]>([])
  const latest = useRef({ albums, comparisons, ratings })
  latest.current = { albums, comparisons, ratings }

  const nextPair = useCallback(() => {
    const { albums: a, comparisons: c, ratings: r } = latest.current
    const seen = new Set(c.map((x) => x.id))
    const merged = [...c, ...pending.current.filter((x) => !seen.has(x.id))]
    setPair(selectPair(a.map((x) => x.id), r, merged, undefined, { focusAlbumId: focusRef.current }))
  }, [])

  // Read through a ref so changing focus does not rebuild nextPair, which would
  // swap the pair out from under a vote in flight.
  const focusRef = useRef(focusAlbumId)
  focusRef.current = focusAlbumId

  // Entering or leaving a focused session invalidates whatever pair is showing.
  useEffect(() => {
    setPair(null)
    setFocusDone(0)
  }, [focusAlbumId])

  useEffect(() => {
    if (!pair && albums.length >= 2) nextPair()
  }, [pair, albums.length, nextPair])

  const submit = useCallback(
    async (winner: string | 'tie' | 'skip') => {
      if (!pair || busy) return
      setBusy(true)
      setError(null)
      try {
        const written = await recordComparison(pair.albumA, pair.albumB, winner)
        pending.current = [...pending.current.slice(-50), written]
        setSessionCount((n) => n + 1)
        // A skip taught us nothing about the album, so it should not count
        // towards finishing a placement run.
        if (focusRef.current && winner !== 'skip') setFocusDone((n) => n + 1)
        setPair(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [pair, busy],
  )

  const albumA = pair ? index.get(pair.albumA) : undefined
  const albumB = pair ? index.get(pair.albumB) : undefined

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!pair || busy || e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === '1' || key === 'arrowleft') void submit(pair.albumA)
      else if (key === '2' || key === 'arrowright') void submit(pair.albumB)
      else if (key === 't') void submit('tie')
      else if (key === 's') void submit('skip')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pair, busy, submit])

  const odds = useMemo(() => {
    if (!pair) return null
    const a = ratings.get(pair.albumA)
    const b = ratings.get(pair.albumB)
    return a && b ? winProbability(a, b) : null
  }, [pair, ratings])

  const focusAlbum = focusAlbumId ? index.get(focusAlbumId) : undefined

  if (focusAlbum && focusDone >= FOCUS_TARGET) {
    const placed = ratings.get(focusAlbum.id)
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-accent-dim/40 bg-accent/10 p-6 text-center">
          <p className="text-lg font-semibold text-white">“{focusAlbum.title}” is placed.</p>
          <p className="mt-1 text-sm text-ink-300">
            {placed
              ? `Sitting at ${Math.round(placed.rating)} ± ${Math.round(placed.ratingDeviation)} after ${FOCUS_TARGET} comparisons.`
              : null}{' '}
            It will keep firming up as it comes back around in normal rotation.
          </p>
        </div>
        <div className="flex justify-center gap-3">
          <button
            type="button"
            onClick={onEndFocus}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-ink-950"
          >
            Back to normal comparisons
          </button>
          <SecondaryButton onClick={() => setFocusDone(0)} disabled={false}>
            Keep going on this one
          </SecondaryButton>
        </div>
      </div>
    )
  }

  if (albums.length < 2) {
    return (
      <Empty>
        <p className="text-lg text-white">Add at least two albums to start comparing.</p>
        <p className="mt-2 text-sm">
          Head to the Library tab to search Spotify, import your top albums, or add one by hand.
        </p>
      </Empty>
    )
  }

  if (!pair || !albumA || !albumB) {
    return <Empty>Finding a pair worth asking about…</Empty>
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Which is better?</h1>
          <p className="mt-1 text-sm text-ink-500">
            {REASON_LABEL[pair.reason]}
            {odds !== null && pair.reason !== 'placement' && pair.reason !== 'focus'
              ? ` · ${Math.round(Math.max(odds, 1 - odds) * 100)}% expected`
              : ''}
          </p>
        </div>
        <p className="text-sm text-ink-500">
          {focusAlbum
            ? `${focusDone} of ${FOCUS_TARGET}`
            : `${sessionCount} this session · ${comparisons.length} in total`}
        </p>
      </header>

      {focusAlbum && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-dim/40 bg-accent/10 px-4 py-2.5">
          <p className="text-sm text-ink-300">
            Placing <span className="font-medium text-white">{focusAlbum.title}</span> — every pair
            below involves it.
          </p>
          <button
            type="button"
            onClick={onEndFocus}
            className="text-xs text-ink-300 underline underline-offset-2 hover:text-white"
          >
            Stop and rank normally
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <ComparisonCard album={albumA} onPick={() => void submit(pair.albumA)} disabled={busy} shortcut="1" />
        <ComparisonCard album={albumB} onPick={() => void submit(pair.albumB)} disabled={busy} shortcut="2" />
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        <SecondaryButton onClick={() => void submit('tie')} disabled={busy}>
          Too close to call <Key>T</Key>
        </SecondaryButton>
        <SecondaryButton onClick={() => void submit('skip')} disabled={busy}>
          Skip — no opinion <Key>S</Key>
        </SecondaryButton>
      </div>

      <p className="text-center text-xs text-ink-700">
        A tie says these are genuinely equal and moves both ratings together. A skip records that
        you passed and leaves both ratings untouched.
      </p>

      {error && <p className="text-center text-sm text-red-400">{error}</p>}
    </div>
  )
}

function SecondaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 rounded-xl border border-ink-800 bg-ink-900 px-4 py-2.5 text-sm font-medium text-ink-300 transition enabled:hover:border-ink-700 enabled:hover:text-white disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-ink-700 px-1.5 py-0.5 font-mono text-xs text-ink-500">
      {children}
    </span>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-ink-800 bg-ink-900 p-10 text-center text-ink-500">
      {children}
    </div>
  )
}
