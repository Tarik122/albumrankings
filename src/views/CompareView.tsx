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
}

const REASON_LABEL: Record<PairReason, string> = {
  placement: 'Placing a new album',
  informative: 'Most informative pair right now',
  wildcard: 'Wildcard',
  audit: 'Checking an old verdict',
}

export function CompareView({ albums, comparisons, ratings, index }: Props) {
  const [pair, setPair] = useState<Pair | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionCount, setSessionCount] = useState(0)

  // Locally recorded comparisons, so a pair cannot be offered again in the
  // moment between writing it and the Firestore snapshot coming back.
  const pending = useRef<Comparison[]>([])
  const latest = useRef({ albums, comparisons, ratings })
  latest.current = { albums, comparisons, ratings }

  const nextPair = useCallback(() => {
    const { albums: a, comparisons: c, ratings: r } = latest.current
    const seen = new Set(c.map((x) => x.id))
    const merged = [...c, ...pending.current.filter((x) => !seen.has(x.id))]
    setPair(selectPair(a.map((x) => x.id), r, merged))
  }, [])

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
            {odds !== null && pair.reason !== 'placement'
              ? ` · ${Math.round(Math.max(odds, 1 - odds) * 100)}% expected`
              : ''}
          </p>
        </div>
        <p className="text-sm text-ink-500">
          {sessionCount} this session · {comparisons.length} in total
        </p>
      </header>

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
