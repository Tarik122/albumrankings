import { useEffect, useMemo, useState } from 'react'
import { fetchPublicAlbums } from '../data/public'
import type { Album } from '../data/types'
import { conservativeRating } from '../rating/glicko2'

/**
 * The page anyone gets without signing in.
 *
 * Read-only by construction: it never imports the write helpers, and the
 * Firestore rules would refuse them anyway.
 */
export function PublicView({ onSignIn }: { onSignIn: () => void }) {
  const [albums, setAlbums] = useState<Album[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    fetchPublicAlbums()
      .then(setAlbums)
      .catch((e: Error) => setError(e.message))
  }, [])

  const ranked = useMemo(() => {
    if (!albums) return []
    return [...albums].sort((a, b) => conservativeRating(b) - conservativeRating(a))
  }, [albums])

  const reviewed = ranked.filter((a) => a.review.trim().length > 0).length

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-white">Album rankings</h1>
          <p className="mt-2 max-w-lg text-sm text-ink-500">
            Ranked by pairwise comparison rather than by scores out of ten — every position here
            came from choosing between two albums, one pair at a time.
          </p>
        </div>
        <button
          type="button"
          onClick={onSignIn}
          className="rounded-xl border border-ink-800 px-4 py-2 text-sm text-ink-500 transition hover:text-white"
        >
          Sign in
        </button>
      </header>

      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {!albums && !error && <p className="text-sm text-ink-500">Loading…</p>}

      {albums && ranked.length === 0 && (
        <p className="rounded-2xl border border-ink-800 bg-ink-900 p-10 text-center text-ink-500">
          Nothing published yet.
        </p>
      )}

      {ranked.length > 0 && (
        <>
          <p className="text-sm text-ink-700">
            {ranked.length} albums · {reviewed} reviewed
          </p>
          <ol className="flex flex-col gap-2">
            {ranked.map((album, position) => {
              const hasReview = album.review.trim().length > 0
              const expanded = open === album.id
              return (
                <li key={album.id} className="rounded-2xl border border-ink-800 bg-ink-900">
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : album.id)}
                    disabled={!hasReview}
                    aria-expanded={hasReview ? expanded : undefined}
                    className="flex w-full items-center gap-3 p-3 text-left enabled:hover:bg-ink-800/50"
                  >
                    <span className="w-8 shrink-0 text-right font-mono text-sm text-ink-700">
                      {position + 1}
                    </span>
                    {album.artUrl ? (
                      <img
                        src={album.artUrl}
                        alt=""
                        className="h-14 w-14 shrink-0 rounded object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-ink-800 text-xl font-semibold text-ink-700">
                        {album.title.trim().charAt(0).toUpperCase() || '?'}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-white">{album.title}</p>
                      <p className="truncate text-sm text-ink-500">
                        {album.artist}
                        {album.releaseYear ? ` · ${album.releaseYear}` : ''}
                      </p>
                    </div>
                    {album.personalScore !== null && (
                      <span className="shrink-0 font-mono text-sm text-accent">
                        {album.personalScore}/10
                      </span>
                    )}
                    {hasReview && (
                      <span className="shrink-0 text-xs text-ink-700">{expanded ? '−' : '+'}</span>
                    )}
                  </button>
                  {hasReview && expanded && (
                    <p className="border-t border-ink-800 p-4 text-sm leading-relaxed whitespace-pre-wrap text-ink-300">
                      {album.review}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        </>
      )}

      <footer className="border-t border-ink-800 pt-5 text-xs text-ink-700">
        Ratings use Glicko-2, so each album carries an uncertainty as well as a score, and one
        careless comparison does not swing a well-established album.
      </footer>
    </div>
  )
}
