import { useCallback, useMemo, useState } from 'react'
import { AlbumThumb } from '../components/AlbumCard'
import { addAlbum, deleteAlbum, findDuplicate } from '../data/albums'
import type { Album } from '../data/types'
import { spotifyClientId } from '../config'
import { beginAuth, isConnected } from '../spotify/auth'
import {
  TIME_RANGE_LABELS,
  fetchRecentAlbums,
  fetchTopAlbums,
  searchAlbums,
  type AlbumSuggestion,
} from '../spotify/import'
import { useAsyncAction } from '../state/store'

interface Props {
  albums: Album[]
}

type Panel = 'search' | 'top' | 'recent' | 'manual'

const PANELS: { id: Panel; label: string }[] = [
  { id: 'search', label: 'Search Spotify' },
  { id: 'top', label: 'Most listened' },
  { id: 'recent', label: 'Recently played' },
  { id: 'manual', label: 'Add by hand' },
]

export function LibraryView({ albums }: Props) {
  const [panel, setPanel] = useState<Panel>('search')
  const connected = isConnected()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-1 rounded-xl border border-ink-800 bg-ink-900 p-1">
        {PANELS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setPanel(option.id)}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              panel === option.id
                ? 'bg-ink-700 text-white'
                : 'text-ink-500 hover:bg-ink-800 hover:text-ink-300'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {panel === 'manual' ? (
        <ManualAdd albums={albums} />
      ) : connected ? (
        <SpotifyPanel panel={panel} albums={albums} />
      ) : (
        <ConnectPrompt />
      )}

      <CurrentLibrary albums={albums} />
    </div>
  )
}

function ConnectPrompt() {
  const [busy, error, run] = useAsyncAction()
  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-900 p-8 text-center">
      <p className="text-white">Connect Spotify to import from your listening history.</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">
        Read-only access to your top tracks and recent plays. Nothing is written to your Spotify
        account, and no token ever leaves this browser.
      </p>
      <button
        type="button"
        disabled={busy || !spotifyClientId}
        onClick={() => void run(beginAuth)}
        className="mt-5 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-ink-950 transition enabled:hover:brightness-110 disabled:opacity-50"
      >
        Connect Spotify
      </button>
      {!spotifyClientId && (
        <p className="mt-3 text-sm text-amber-400">
          No client id configured — set VITE_SPOTIFY_CLIENT_ID (SETUP.md step 6).
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  )
}

function SpotifyPanel({ panel, albums }: { panel: Panel; albums: Album[] }) {
  const [queryText, setQueryText] = useState('')
  const [suggestions, setSuggestions] = useState<AlbumSuggestion[] | null>(null)
  const [busy, error, run] = useAsyncAction()

  const load = useCallback(
    (loader: () => Promise<AlbumSuggestion[]>) =>
      run(async () => {
        setSuggestions(await loader())
      }),
    [run],
  )

  /**
   * Recently-played is a suggestion feed, so it only shows albums that are not
   * already in the library — the point is "what have I been listening to that I
   * haven't ranked yet", not a replay of things already in there.
   */
  const shown = useMemo(() => {
    if (!suggestions) return null
    if (panel !== 'recent') return suggestions
    return suggestions.filter((s) => !findDuplicate(s, albums))
  }, [suggestions, panel, albums])

  return (
    <div className="flex flex-col gap-4">
      {panel === 'search' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void load(() => searchAlbums(queryText))
          }}
          className="flex flex-col gap-2"
        >
          <div className="flex gap-2">
            <input
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Artist and album, e.g. “radiohead in rainbows”"
              className="min-w-0 flex-1 rounded-xl border border-ink-800 bg-ink-900 px-4 py-2.5 text-sm text-white placeholder:text-ink-700 focus:border-accent-dim focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-ink-950 disabled:opacity-50"
            >
              Search
            </button>
          </div>
          <p className="text-xs text-ink-700">
            Spotify caps album search at 10 results, so a narrow query beats a broad one — include
            the artist name.
          </p>
        </form>
      )}

      {panel === 'top' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void load(() => fetchTopAlbums())}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-ink-950 disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Find my most-listened albums'}
            </button>
            {(['short_term', 'medium_term', 'long_term'] as const).map((range) => (
              <button
                key={range}
                type="button"
                disabled={busy}
                onClick={() => void load(() => fetchTopAlbums([range]))}
                className="rounded-xl border border-ink-800 bg-ink-900 px-4 py-2.5 text-sm text-ink-300 disabled:opacity-50"
              >
                {TIME_RANGE_LABELS[range]}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-700">
            Spotify has no “top albums” endpoint, so this rolls your top tracks up to their albums
            and weights each by how high the track ranked. Singles are left out.
          </p>
        </div>
      )}

      {panel === 'recent' && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void load(fetchRecentAlbums)}
            className="self-start rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-ink-950 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'What have I played that isn’t ranked?'}
          </button>
          <p className="text-xs text-ink-700">
            Spotify only exposes the last 50 plays, so this is a rolling window — check it now and
            then rather than expecting full history.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {shown && shown.length === 0 && (
        <p className="rounded-xl border border-ink-800 bg-ink-900 p-6 text-center text-sm text-ink-500">
          {panel === 'recent' ? 'Everything you’ve played recently is already ranked.' : 'No results.'}
        </p>
      )}

      {shown && shown.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {shown.map((suggestion) => (
            <SuggestionRow key={suggestion.spotifyAlbumId} suggestion={suggestion} albums={albums} />
          ))}
        </ul>
      )}
    </div>
  )
}

function SuggestionRow({ suggestion, albums }: { suggestion: AlbumSuggestion; albums: Album[] }) {
  const [busy, error, run] = useAsyncAction()
  const [added, setAdded] = useState(false)
  const existing = findDuplicate(suggestion, albums)

  return (
    <li className="flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-900 p-2.5">
      {suggestion.artUrl ? (
        <img src={suggestion.artUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
      ) : (
        <div className="h-12 w-12 shrink-0 rounded bg-ink-800" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{suggestion.title}</p>
        <p className="truncate text-xs text-ink-500">
          {suggestion.artist}
          {suggestion.releaseYear ? ` · ${suggestion.releaseYear}` : ''}
          {suggestion.tracks.length > 0 ? ` · ${suggestion.tracks.length} tracks you play` : ''}
        </p>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
      {existing || added ? (
        <span className="shrink-0 px-3 text-xs text-ink-700">In library</span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await addAlbum(suggestion, albums)
              setAdded(true)
            })
          }
          className="shrink-0 rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-300 transition enabled:hover:border-accent-dim enabled:hover:text-white disabled:opacity-50"
        >
          Add
        </button>
      )}
    </li>
  )
}

function ManualAdd({ albums }: { albums: Album[] }) {
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [busy, error, run] = useAsyncAction()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim() || !artist.trim()) return
        void run(async () => {
          const existing = findDuplicate({ title, artist, spotifyAlbumId: null }, albums)
          await addAlbum({ title, artist, source: 'manual' }, albums)
          setNote(existing ? `“${existing.title}” is already in your library.` : `Added “${title}”.`)
          setTitle('')
          setArtist('')
        })
      }}
      className="flex flex-col gap-3 rounded-2xl border border-ink-800 bg-ink-900 p-5"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          placeholder="Artist"
          className="rounded-xl border border-ink-800 bg-ink-950 px-4 py-2.5 text-sm text-white placeholder:text-ink-700 focus:border-accent-dim focus:outline-none"
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Album title"
          className="rounded-xl border border-ink-800 bg-ink-950 px-4 py-2.5 text-sm text-white placeholder:text-ink-700 focus:border-accent-dim focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={busy || !title.trim() || !artist.trim()}
        className="self-start rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-ink-950 disabled:opacity-50"
      >
        Add album
      </button>
      <p className="text-xs text-ink-700">
        Added by hand now, it can still be matched to Spotify later — the album keeps its id, so
        nothing you have already compared is lost.
      </p>
      {note && <p className="text-sm text-accent">{note}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  )
}

function CurrentLibrary({ albums }: { albums: Album[] }) {
  const [filter, setFilter] = useState('')
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return albums
    return albums.filter(
      (a) =>
        a.title.toLowerCase().includes(needle) || a.artist.toLowerCase().includes(needle),
    )
  }, [albums, filter])

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">
          Library <span className="text-ink-700">({albums.length})</span>
        </h2>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="rounded-xl border border-ink-800 bg-ink-900 px-3 py-1.5 text-sm text-white placeholder:text-ink-700 focus:border-accent-dim focus:outline-none"
        />
      </div>
      <ul className="flex flex-col gap-1.5">
        {shown.map((album) => (
          <LibraryRow key={album.id} album={album} />
        ))}
      </ul>
    </section>
  )
}

function LibraryRow({ album }: { album: Album }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, error, run] = useAsyncAction()

  return (
    <li className="flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-900 p-2.5">
      <AlbumThumb album={album} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{album.title}</p>
        <p className="truncate text-xs text-ink-500">
          {album.artist} · {album.comparisonCount} comparisons
        </p>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
      {confirming ? (
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => deleteAlbum(album.id))}
            className="rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-400 disabled:opacity-50"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-lg px-3 py-1.5 text-xs text-ink-500"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="shrink-0 rounded-lg px-3 py-1.5 text-xs text-ink-700 transition hover:text-ink-300"
        >
          Remove
        </button>
      )}
    </li>
  )
}
