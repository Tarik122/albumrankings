import { useState } from 'react'
import type { User } from 'firebase/auth'
import { ownerConfigured, signOutOwner } from '../data/auth'
import { ownerUid, spotifyClientId, spotifyRedirectUri } from '../config'
import { disconnect, isConnected } from '../spotify/auth'
import { DEFAULT_ENGINE_CONFIG } from '../rating/engine'
import { DEFAULT_MATCHMAKING } from '../rating/matchmaking'
import type { Album, Comparison } from '../data/types'

interface Props {
  user: User
  albums: Album[]
  comparisons: Comparison[]
}

export function SettingsView({ user, albums, comparisons }: Props) {
  const [copied, setCopied] = useState(false)
  const [spotify, setSpotify] = useState(isConnected())

  return (
    <div className="flex flex-col gap-6">
      <Section title="Account">
        <Field label="Signed in as" value={user.email ?? '—'} />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field label="Your Firebase UID" value={user.uid} mono />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(user.uid)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
            className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:text-white"
          >
            {copied ? 'Copied' : 'Copy UID'}
          </button>
        </div>

        {!ownerConfigured() ? (
          <Callout tone="warn">
            <p className="font-medium text-amber-300">The database is not locked down yet.</p>
            <p className="mt-1">
              Copy the UID above into <code className="text-amber-300">VITE_OWNER_UID</code> in
              your <code className="text-amber-300">.env.local</code>, and replace{' '}
              <code className="text-amber-300">OWNER_UID_HERE</code> in{' '}
              <code className="text-amber-300">firestore.rules</code> with the same value, then
              publish the rules in the Firebase console. Until you do, anyone with a Google account
              can read and write your data.
            </p>
          </Callout>
        ) : ownerUid === user.uid ? (
          <Callout tone="ok">
            Locked to this account. Confirm{' '}
            <code className="text-accent">firestore.rules</code> carries the same UID and is
            published — the rules are what actually enforce it.
          </Callout>
        ) : (
          <Callout tone="warn">
            This account is not the configured owner. Firestore will refuse every request.
          </Callout>
        )}

        <button
          type="button"
          onClick={() => void signOutOwner()}
          className="self-start rounded-xl border border-ink-800 px-4 py-2 text-sm text-ink-300 hover:text-white"
        >
          Sign out
        </button>
      </Section>

      <Section title="Spotify">
        <Field label="Client id" value={spotifyClientId || 'not configured'} mono />
        <Field label="Redirect URI" value={spotifyRedirectUri} mono />
        <p className="text-xs text-ink-700">
          This exact URI must be registered in the Spotify dashboard, character for character. In
          local development Spotify requires the loopback IP — <code>127.0.0.1</code>, not{' '}
          <code>localhost</code>.
        </p>
        {spotify ? (
          <button
            type="button"
            onClick={() => {
              disconnect()
              setSpotify(false)
            }}
            className="self-start rounded-xl border border-ink-800 px-4 py-2 text-sm text-ink-300 hover:text-white"
          >
            Disconnect Spotify
          </button>
        ) : (
          <p className="text-sm text-ink-500">Not connected. Connect from the Library tab.</p>
        )}
      </Section>

      <Section title="Rating configuration">
        <p className="text-sm text-ink-500">
          Ratings are derived from the comparison log, never stored as the last word. Change any of
          these in <code className="text-ink-300">src/rating/</code> and the whole history is
          re-scored on the next load — nothing is baked in.
        </p>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Config name="τ (system constant)" value={DEFAULT_ENGINE_CONFIG.tau} />
          <Config name="Rating period" value={`${DEFAULT_ENGINE_CONFIG.periodSize} comparisons`} />
          <Config name="Idle inflation" value={`${DEFAULT_ENGINE_CONFIG.idleInflation}×`} />
          <Config name="RD ceiling (established)" value={DEFAULT_ENGINE_CONFIG.maxEstablishedRd} />
          <Config name="Wildcard rate" value={`${DEFAULT_MATCHMAKING.wildcardRate * 100}%`} />
          <Config name="Placement target" value={`${DEFAULT_MATCHMAKING.placementTarget} comparisons`} />
        </dl>
      </Section>

      <Section title="Your data">
        <Field label="Albums" value={String(albums.length)} />
        <Field label="Comparisons logged" value={String(comparisons.length)} />
        <button
          type="button"
          onClick={() => downloadBackup(albums, comparisons)}
          className="self-start rounded-xl border border-ink-800 px-4 py-2 text-sm text-ink-300 hover:text-white"
        >
          Download a JSON backup
        </button>
        <p className="text-xs text-ink-700">
          The comparison log is the irreplaceable part — ratings can always be recomputed from it,
          but nothing can reconstruct it.
        </p>
      </Section>
    </div>
  )
}

function downloadBackup(albums: Album[], comparisons: Comparison[]): void {
  const blob = new Blob([JSON.stringify({ albums, comparisons, exportedAt: Date.now() }, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `album-rankings-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-ink-800 bg-ink-900 p-5">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-ink-500">{label}</p>
      <p className={`truncate text-sm text-white ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

function Config({ name, value }: { name: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-4 border-b border-ink-800 pb-1.5">
      <dt className="text-sm text-ink-500">{name}</dt>
      <dd className="font-mono text-sm text-ink-300">{value}</dd>
    </div>
  )
}

function Callout({ tone, children }: { tone: 'ok' | 'warn'; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-xl border p-3 text-sm ${
        tone === 'warn'
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-200/90'
          : 'border-accent-dim/30 bg-accent/10 text-ink-300'
      }`}
    >
      {children}
    </div>
  )
}
