import { useEffect, useState } from 'react'
import { updateAlbumMeta } from '../data/albums'
import type { Album, Comparison } from '../data/types'
import { outcomeOf } from '../data/types'
import type { RatingTable } from '../rating/engine'
import { conservativeRating } from '../rating/glicko2'
import { useAsyncAction } from '../state/store'

interface Props {
  album: Album
  ratings: RatingTable
  comparisons: Comparison[]
  index: Map<string, Album>
  onClose: () => void
  onPlaceNow: (albumId: string) => void
}

/**
 * Everything about one album: its computed standing, your review, and its head
 * to head record.
 *
 * The review and the personal score are stored on the album document and are
 * deliberately kept out of the rating engine — the ranking stays a pure
 * function of the comparison log. Seeing your own score next to the rating your
 * choices produced is the point; they are allowed to disagree.
 */
export function AlbumDetail({ album, ratings, comparisons, index, onClose, onPlaceNow }: Props) {
  const [review, setReview] = useState(album.review)
  const [score, setScore] = useState<string>(
    album.personalScore === null ? '' : String(album.personalScore),
  )
  const [isPublic, setIsPublic] = useState(album.isPublic)
  const [saved, setSaved] = useState(false)
  const [busy, error, run] = useAsyncAction()

  // Switching to a different album while the panel is open must not carry the
  // previous album's unsaved text across.
  useEffect(() => {
    setReview(album.review)
    setScore(album.personalScore === null ? '' : String(album.personalScore))
    setIsPublic(album.isPublic)
    setSaved(false)
  }, [album.id, album.review, album.personalScore, album.isPublic])

  const rating = ratings.get(album.id)
  const record = comparisons.filter((c) => c.albumA === album.id || c.albumB === album.id)

  const parsedScore = score.trim() === '' ? null : Number(score)
  const scoreValid =
    parsedScore === null || (Number.isFinite(parsedScore) && parsedScore >= 0 && parsedScore <= 10)

  const dirty =
    review !== album.review ||
    parsedScore !== album.personalScore ||
    isPublic !== album.isPublic

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/80 p-0 sm:items-center sm:p-6">
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-y-auto rounded-t-2xl border border-ink-800 bg-ink-900 sm:rounded-2xl">
        <header className="flex items-start gap-4 border-b border-ink-800 p-5">
          {album.artUrl ? (
            <img src={album.artUrl} alt="" className="h-20 w-20 shrink-0 rounded object-cover" />
          ) : (
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded bg-ink-800 text-3xl font-semibold text-ink-700">
              {album.title.trim().charAt(0).toUpperCase() || '?'}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg leading-tight font-semibold text-white">{album.title}</h2>
            <p className="text-sm text-ink-500">
              {album.artist}
              {album.releaseYear ? ` · ${album.releaseYear}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg px-2 py-1 text-lg text-ink-500 hover:text-white"
          >
            ×
          </button>
        </header>

        <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
          <Stat label="Rating" value={rating ? Math.round(rating.rating) : '—'} />
          <Stat label="Uncertainty" value={rating ? `±${Math.round(rating.ratingDeviation)}` : '—'} />
          <Stat
            label="Record"
            value={rating ? `${rating.wins}–${rating.losses}${rating.ties ? `–${rating.ties}` : ''}` : '—'}
          />
          <Stat
            label="Confident score"
            value={rating ? Math.round(conservativeRating(rating)) : '—'}
          />
        </div>

        {rating && rating.comparisonCount < 5 && (
          <div className="mx-5 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-800 bg-ink-950 p-3">
            <p className="text-sm text-ink-500">
              Only {rating.comparisonCount} comparison{rating.comparisonCount === 1 ? '' : 's'} so
              far — this rating is still a guess.
            </p>
            <button
              type="button"
              onClick={() => onPlaceNow(album.id)}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-ink-950"
            >
              Place it now
            </button>
          </div>
        )}

        <div className="flex flex-col gap-4 border-t border-ink-800 p-5">
          <div>
            <label htmlFor="review" className="text-sm font-medium text-white">
              Review
            </label>
            <textarea
              id="review"
              value={review}
              onChange={(e) => setReview(e.target.value)}
              rows={6}
              placeholder="What did you make of it?"
              className="mt-1.5 w-full rounded-xl border border-ink-800 bg-ink-950 px-4 py-3 text-sm text-white placeholder:text-ink-700 focus:border-accent-dim focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-end gap-5">
            <div>
              <label htmlFor="score" className="text-sm font-medium text-white">
                Your score
              </label>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <input
                  id="score"
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                  inputMode="decimal"
                  placeholder="—"
                  className={`w-20 rounded-xl border bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-ink-700 focus:outline-none ${
                    scoreValid ? 'border-ink-800 focus:border-accent-dim' : 'border-red-500/60'
                  }`}
                />
                <span className="text-sm text-ink-500">/ 10</span>
              </div>
            </div>

            <label className="flex items-center gap-2.5 pb-2">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              <span className="text-sm text-ink-300">Show on the public page</span>
            </label>
          </div>

          <p className="text-xs text-ink-700">
            Your score is stored next to the rating but never feeds it — the ranking stays a pure
            function of the comparisons you actually made. Unticking the box hides this album and
            its review from the public page entirely; that is enforced by the database rules, not
            just the interface.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || !dirty || !scoreValid}
              onClick={() =>
                void run(async () => {
                  await updateAlbumMeta(album.id, { review, personalScore: parsedScore, isPublic })
                  setSaved(true)
                })
              }
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-ink-950 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            {!scoreValid && <span className="text-sm text-red-400">Score must be 0–10.</span>}
            {saved && !dirty && <span className="text-sm text-accent">Saved.</span>}
            {error && <span className="text-sm text-red-400">{error}</span>}
          </div>
        </div>

        {record.length > 0 && (
          <div className="border-t border-ink-800 p-5">
            <h3 className="text-sm font-medium text-white">
              Head to head <span className="text-ink-700">({record.length})</span>
            </h3>
            <ul className="mt-2 flex flex-col gap-1">
              {record
                .slice(-30)
                .reverse()
                .map((c) => {
                  const otherId = c.albumA === album.id ? c.albumB : c.albumA
                  const other = index.get(otherId)
                  const outcome = outcomeOf(c)
                  const verdict =
                    outcome === 'skip'
                      ? { text: 'skipped', tone: 'text-ink-700' }
                      : outcome === 'tie'
                        ? { text: 'tied with', tone: 'text-ink-500' }
                        : c.winner === album.id
                          ? { text: 'beat', tone: 'text-accent' }
                          : { text: 'lost to', tone: 'text-red-400/80' }
                  return (
                    <li key={c.id} className="flex gap-2 text-sm">
                      <span className={`shrink-0 ${verdict.tone}`}>{verdict.text}</span>
                      <span className="truncate text-ink-300">{other?.title ?? 'a removed album'}</span>
                    </li>
                  )
                })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-950 p-3">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="mt-0.5 font-mono text-base text-white">{value}</p>
    </div>
  )
}
