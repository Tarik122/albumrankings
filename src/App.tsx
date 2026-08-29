import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { Tabs, type TabId } from './components/Tabs'
import { isOwner, ownerConfigured, signIn, watchAuth } from './data/auth'
import { useAlbumIndex, useAsyncAction, useLibrary } from './state/store'
import { completeAuthIfRedirected } from './spotify/auth'
import { CompareView } from './views/CompareView'
import { LeaderboardView } from './views/LeaderboardView'
import { LibraryView } from './views/LibraryView'
import { SettingsView } from './views/SettingsView'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [tab, setTab] = useState<TabId>('compare')
  const [spotifyError, setSpotifyError] = useState<string | null>(null)

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
  if (!user) return <SignIn />
  if (!isOwner(user)) return <NotOwner email={user.email} />

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
          />
        ) : tab === 'leaderboard' ? (
          <LeaderboardView
            albums={library.albums}
            comparisons={library.comparisons}
            ratings={library.ratings}
          />
        ) : tab === 'library' ? (
          <LibraryView albums={library.albums} />
        ) : (
          <SettingsView user={user} albums={library.albums} comparisons={library.comparisons} />
        )}
      </main>
    </div>
  )
}

function SignIn() {
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
