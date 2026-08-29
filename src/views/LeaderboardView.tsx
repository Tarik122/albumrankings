import { useMemo, useState } from 'react'
import { AlbumThumb } from '../components/AlbumCard'
import type { Album, Comparison } from '../data/types'
import type { RatingTable } from '../rating/engine'
import { conservativeRating } from '../rating/glicko2'

interface Props {
  albums: Album[]
  comparisons: Comparison[]
  ratings: RatingTable
  onOpenAlbum: (id: string) => void
}

type SortMode = 'conservative' | 'rating' | 'uncertain'

const SORTS: { id: SortMode; label: string; hint: string }[] = [
  {
    id: 'conservative',
    label: 'Confident ranking',
    hint: 'Ranked by the bottom of each 95% interval — an album has to earn its place.',
  },
  { id: 'rating', label: 'Raw rating', hint: 'Straight Glicko-2 rating, uncertainty ignored.' },
  {
    id: 'uncertain',
    label: 'Least settled',
    hint: 'Widest uncertainty first — these are the albums worth comparing next.',
  },
]

export function LeaderboardView({ albums, comparisons, ratings, onOpenAlbum }: Props) {
  const [sort, setSort] = useState<SortMode>('conservative')

  const rows = useMemo(() => {
    const list = albums
      .map((album) => ({ album, r: ratings.get(album.id) }))
      .filter((row): row is { album: Album; r: NonNullable<typeof row.r> } => Boolean(row.r))

    const compare = {
      conservative: (a: typeof list[number], b: typeof list[number]) =>
        conservativeRating(b.r) - conservativeRating(a.r),
      rating: (a: typeof list[number], b: typeof list[number]) => b.r.rating - a.r.rating,
      uncertain: (a: typeof list[number], b: typeof list[number]) =>
        b.r.ratingDeviation - a.r.ratingDeviation || a.r.comparisonCount - b.r.comparisonCount,
    }[sort]

    return [...list].sort(compare)
  }, [albums, ratings, sort])

  const stats = useMemo(() => {
    const rated = albums.filter((a) => (ratings.get(a.id)?.comparisonCount ?? 0) > 0)
    const skips = comparisons.filter((c) => c.winner === 'skip').length
    const ties = comparisons.filter((c) => c.winner === 'tie').length
    const settled = albums.filter((a) => (ratings.get(a.id)?.ratingDeviation ?? 350) < 100).length
    return { rated: rated.length, skips, ties, settled }
  }, [albums, comparisons, ratings])

  if (albums.length === 0) {
    return (
      <p className="rounded-2xl border border-ink-800 bg-ink-900 p-10 text-center text-ink-500">
        Nothing ranked yet. Add albums in the Library tab.
      </p>
    )
  }

  const activeSort = SORTS.find((s) => s.id === sort)!

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Albums" value={albums.length} />
        <Stat label="Comparisons" value={comparisons.length} />
        <Stat label="Settled" value={stats.settled} hint="RD below 100" />
        <Stat label="Ties / skips" value={`${stats.ties} / ${stats.skips}`} />
      </div>

      <div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-ink-800 bg-ink-900 p-1">
          {SORTS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSort(option.id)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                sort === option.id
                  ? 'bg-ink-700 text-white'
                  : 'text-ink-500 hover:bg-ink-800 hover:text-ink-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-700">{activeSort.hint}</p>
      </div>

      <ol className="flex flex-col gap-1.5">
        {rows.map((row, position) => (
          <li key={row.album.id}>
            <button
              type="button"
              onClick={() => onOpenAlbum(row.album.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-ink-800 bg-ink-900 p-2.5 text-left transition hover:border-ink-700"
            >
              <span className="w-8 shrink-0 text-right font-mono text-sm text-ink-700">
                {position + 1}
              </span>
              <AlbumThumb album={row.album} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{row.album.title}</p>
                <p className="truncate text-xs text-ink-500">
                  {row.album.artist}
                  {row.album.review.trim() ? ' · reviewed' : ''}
                  {!row.album.isPublic ? ' · private' : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-sm text-white">{Math.round(row.r.rating)}</p>
                <p className="font-mono text-xs text-ink-700">
                  ±{Math.round(row.r.ratingDeviation)} · {row.r.comparisonCount}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ol>

      <p className="text-xs text-ink-700">
        Each row shows the rating, its uncertainty (±RD), and how many comparisons fed it. An album
        with a wide interval has not been asked about enough yet — the matchmaker prioritises those.
      </p>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900 p-3">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-white">{value}</p>
      {hint && <p className="text-[11px] text-ink-700">{hint}</p>}
    </div>
  )
}
