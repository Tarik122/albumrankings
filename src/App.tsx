import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { Tabs, type TabId } from './components/Tabs'
import { isOwner, ownerConfigured, signIn, watchAuth } from './data/auth'
import { useAlbumIndex, useAsyncAction, useLibrary } from './state/store'
import { completeAuthIfRedirected } from './spotify/auth'
import { AlbumDetail } from './views/AlbumDetail'
import { CompareView } from './views/CompareView'
import { LeaderboardView } from './views/LeaderboardView'
import { LibraryView } from './views/LibraryView'
import { PublicView } from './views/PublicView'
import { SettingsView } from './views/SettingsView'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [tab, setTab] = useState<TabId>('compare')
  const [spotifyError, setSpotifyError] = useState<string | null>(null)
  const [openAlbumId, setOpenAlbumId] = useState<string | null>(null)
  const [focusAlbumId, setFocusAlbumId] = useState<string | null>(null)
  const [wantsSignIn, setWantsSignIn] = useState(false)

  useEffect(
    () =>
      watchAuth((next) => {
        setUser(next)
        setAuthReady(true)
      }),
    [],
  )

  // A Spotify redirect lands back on this page with ?code=…; consume it before
  // anything else so the code is never left sitting in the address bar.
  useEffect(() => {
    completeAuthIfRedirected()
      .then((completed) => {
        if (completed) setTab('library')
      })
      .catch((e: Error) => setSpotifyError(e.message))
  }, [])

  const library = useLibrary(user)
  const index = useAlbumIndex(library.albums)

  if (!authReady) return <Centered>Loading…</Centered>
  // Signed-out visitors get the public rankings at the same URL, so there is
  // one link to share and no dead end for anyone who follows it.
  if (!user) {
    return wantsSignIn ? (
      <SignIn onBack={() => setWantsSignIn(false)} />
    ) : (
      <PublicView onSignIn={() => setWantsSignIn(true)} />
    )
  }
  if (!isOwner(user)) return <NotOwner email={user.email} />

  const openAlbum = openAlbumId ? index.get(openAlbumId) : undefined

  const placeNow = (albumId: string) => {
    setOpenAlbumId(null)
    setFocusAlbumId(albumId)
    setTab('compare')
  }

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-sm font-semibold tracking-wide text-ink-500 uppercase">Album Ranker</h1>
        <Tabs active={tab} onChange={setTab} />
      </header>

      {!ownerConfigured() && tab !== 'settings' && (
        <button
          type="button"
          onClick={() => setTab('settings')}
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-left text-sm text-amber-200/90"
        >
          Your database is not locked to your account yet. Open Settings to finish securing it.
        </button>
      )}

      {spotifyError && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {spotifyError}
        </p>
      )}

      {library.error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {library.error}
        </p>
      )}

      <main className="flex-1">
        {library.loading ? (
          <Centered>Loading your library…</Centered>
        ) : tab === 'compare' ? (
          <CompareView
            albums={library.albums}
            comparisons={library.comparisons}
            ratings={library.ratings}
            index={index}
            focusAlbumId={focusAlbumId}
            onEndFocus={() => setFocusAlbumId(null)}
          />
        ) : tab === 'leaderboard' ? (
          <LeaderboardView
            albums={library.albums}
            comparisons={library.comparisons}
            ratings={library.ratings}
            onOpenAlbum={setOpenAlbumId}
          />
        ) : tab === 'library' ? (
          <LibraryView albums={library.albums} onOpenAlbum={setOpenAlbumId} onPlaceNow={placeNow} />
        ) : (
          <SettingsView user={user} albums={library.albums} comparisons={library.comparisons} />
        )}
      </main>

      {openAlbum && (
        <AlbumDetail
          album={openAlbum}
          ratings={library.ratings}
          comparisons={library.comparisons}
          index={index}
          onClose={() => setOpenAlbumId(null)}
          onPlaceNow={placeNow}
        />
      )}
    </div>
  )
}

function SignIn({ onBack }: { onBack: () => void }) {
  const [busy, error, run] = useAsyncAction()
  return (
    <Centered>
      <h1 className="text-2xl font-semibold text-white">Album Ranker</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-500">
        Rank your listening history by comparing two albums at a time, instead of inventing scores
        out of nowhere.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(signIn)}
        className="mt-6 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-ink-950 transition enabled:hover:brightness-110 disabled:opacity-50"
      >
        Sign in with Google
      </button>
      {error && <p className="mt-4 max-w-sm text-sm text-red-400">{error}</p>}
      <button
        type="button"
        onClick={onBack}
        className="mt-4 text-sm text-ink-700 underline underline-offset-2 hover:text-ink-300"
      >
        Back to the rankings
      </button>
    </Centered>
  )
}

function NotOwner({ email }: { email: string | null }) {
  return (
    <Centered>
      <h1 className="text-xl font-semibold text-white">This isn’t your library</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-500">
        {email ? `${email} is not the owner of this instance.` : 'This account is not the owner.'}{' '}
        Sign in with the account that set it up.
      </p>
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-16 text-center text-ink-500">
      {children}
    </div>
  )
}
