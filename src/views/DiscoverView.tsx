import { useMemo, useState } from 'react'
import { AlbumThumb } from '../components/AlbumCard'
import { addAlbum, findDuplicate } from '../data/albums'
import type { Album, Comparison } from '../data/types'
import type { RatingTable } from '../rating/engine'
import {
  artistAffinities,
  disagreements,
  mindChangers,
  staleFavourites,
} from '../rating/insights'
import { isConnected } from '../spotify/auth'
import { findArtistGaps, findGenreNeighbours, type Recommendation } from '../spotify/discover'
import { useAsyncAction } from '../state/store'

interface Props {
  albums: Album[]
  comparisons: Comparison[]
  ratings: RatingTable
  onOpenAlbum: (id: string) => void
  onPlaceNow: (id: string) => void
}

/**
 * Recommendations and taste analysis.
 *
 * The lower half needs no network at all — it is read out of the ranking you
 * already built. The upper half asks Spotify for records you do not have, and
 * says plainly where each suggestion came from: an opaque relevance score would
 * be worse than useless in an app whose whole point is legible judgement.
 */
export function DiscoverView({ albums, comparisons, ratings, onOpenAlbum, onPlaceNow }: Props) {
  const affinities = useMemo(() => artistAffinities(albums, ratings), [albums, ratings])
  const connected = isConnected()

  const enoughData = affinities.length >= 2

  return (
    <div className="flex flex-col gap-8">
      {!enoughData && (
        <p className="rounded-2xl border border-ink-800 bg-ink-900 p-6 text-center text-sm text-ink-500">
          Compare a few more albums first. Recommendations are built out of your ranking, so they
          need a ranking to work from — three or four comparisons on a handful of albums is enough
          to start.
        </p>
      )}

      {enoughData && connected && <SpotifySuggestions affinities={affinities} albums={albums} onPlaceNow={onPlaceNow} />}

      {enoughData && !connected && (
        <p className="rounded-2xl border border-ink-800 bg-ink-900 p-6 text-sm text-ink-500">
          Connect Spotify in the Library tab to get suggestions for albums you don’t own yet. The
          sections below work without it.
        </p>
      )}

      {enoughData && (
        <TasteSections
          albums={albums}
          comparisons={comparisons}
          ratings={ratings}
          affinities={affinities}
          onOpenAlbum={onOpenAlbum}
        />
      )}
    </div>
  )
}

function SpotifySuggestions({
  affinities,
  albums,
  onPlaceNow,
}: {
  affinities: ReturnType<typeof artistAffinities>
  albums: Album[]
  onPlaceNow: (id: string) => void
}) {
  const [gaps, setGaps] = useState<Recommendation[] | null>(null)
  const [neighbours, setNeighbours] = useState<Recommendation[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busyGaps, gapError, runGaps] = useAsyncAction()
  const [busyNear, nearError, runNear] = useAsyncAction()

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Fill the gaps"
        blurb="Records by artists your ranking says you like, that aren’t in your library yet. No claim about what they sound like — just that you rate the artist and haven’t heard this one."
      >
        <button
          type="button"
          disabled={busyGaps}
          onClick={() => void runGaps(async () => setGaps(await findArtistGaps(affinities, albums)))}
          className="self-start rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-ink-950 disabled:opacity-50"
        >
          {busyGaps ? 'Searching…' : 'Find what I’m missing'}
        </button>
        {gapError && <p className="text-sm text-red-400">{gapError}</p>}
        <Results items={gaps} albums={albums} onPlaceNow={onPlaceNow} empty="Nothing missing — you have everything Spotify lists for your top artists." />
      </Section>

      <Section
        title="Further afield"
        blurb="Artists sharing the genres your favourites cluster in. Spotify withdrew its recommendation and related-artist endpoints, so this is assembled from genre tags rather than asked for — treat it as a rougher signal than the section above."
      >
        <button
          type="button"
          disabled={busyNear}
          onClick={() =>
            void runNear(async () => {
              const { results, note: n } = await findGenreNeighbours(affinities, albums)
              setNeighbours(results)
              setNote(n)
            })
          }
          className="self-start rounded-xl border border-ink-800 bg-ink-900 px-4 py-2.5 text-sm text-ink-300 disabled:opacity-50"
        >
          {busyNear ? 'Searching…' : 'Show me something new'}
        </button>
        {nearError && <p className="text-sm text-red-400">{nearError}</p>}
        {note && <p className="text-sm text-ink-500">{note}</p>}
        <Results items={neighbours} albums={albums} onPlaceNow={onPlaceNow} empty="Nothing new came back." />
      </Section>
    </div>
  )
}

function Results({
  items,
  albums,
  onPlaceNow,
  empty,
}: {
  items: Recommendation[] | null
  albums: Album[]
  onPlaceNow: (id: string) => void
  empty: string
}) {
  if (!items) return null
  if (items.length === 0) return <p className="text-sm text-ink-500">{empty}</p>
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => (
        <RecommendationRow
          key={item.spotifyAlbumId}
          item={item}
          albums={albums}
          onPlaceNow={onPlaceNow}
        />
      ))}
    </ul>
  )
}

function RecommendationRow({
  item,
  albums,
  onPlaceNow,
}: {
  item: Recommendation
  albums: Album[]
  onPlaceNow: (id: string) => void
}) {
  const [added, setAdded] = useState<string | null>(null)
  const [busy, error, run] = useAsyncAction()
  const existing = findDuplicate(item, albums)

  return (
    <li className="flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-900 p-2.5">
      {item.artUrl ? (
        <img src={item.artUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" loading="lazy" />
      ) : (
        <div className="h-12 w-12 shrink-0 rounded bg-ink-800" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{item.title}</p>
        <p className="truncate text-xs text-ink-500">
          {item.artist}
          {item.releaseYear ? ` · ${item.releaseYear}` : ''}
        </p>
        <p className="truncate text-xs text-ink-700">{item.reason}</p>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
      {added ? (
        <button
          type="button"
          onClick={() => onPlaceNow(added)}
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-ink-950"
        >
          Rate it now
        </button>
      ) : existing ? (
        <span className="shrink-0 px-3 text-xs text-ink-700">In library</span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const album = await addAlbum(item, albums)
              setAdded(album.id)
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

function TasteSections({
  albums,
  comparisons,
  ratings,
  affinities,
  onOpenAlbum,
}: {
  albums: Album[]
  comparisons: Comparison[]
  ratings: RatingTable
  affinities: ReturnType<typeof artistAffinities>
  onOpenAlbum: (id: string) => void
}) {
  const gaps = useMemo(() => disagreements(albums, ratings).slice(0, 6), [albums, ratings])
  const erratic = useMemo(
    () => mindChangers(albums, ratings, comparisons, 6),
    [albums, ratings, comparisons],
  )
  const stale = useMemo(
    () => staleFavourites(albums, ratings, comparisons, 6),
    [albums, ratings, comparisons],
  )

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Your artists"
        blurb="Ranked by how far their albums sit above your library average, weighting each by how certain its rating is — so one lucky result doesn’t make someone a favourite."
      >
        <ol className="flex flex-col gap-1.5">
          {affinities.slice(0, 8).map((a, i) => (
            <li
              key={a.artist}
              className="flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-900 p-2.5"
            >
              <span className="w-6 shrink-0 text-right font-mono text-sm text-ink-700">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{a.artist}</p>
                <p className="truncate text-xs text-ink-500">
                  {a.albums.length} album{a.albums.length === 1 ? '' : 's'} · best is {a.best.title}
                </p>
              </div>
              <span
                className={`shrink-0 font-mono text-sm ${a.affinity >= 0 ? 'text-accent' : 'text-ink-700'}`}
              >
                {a.affinity >= 0 ? '+' : ''}
                {Math.round(a.affinity)}
              </span>
            </li>
          ))}
        </ol>
      </Section>

      {gaps.length > 0 && (
        <Section
          title="Where you disagree with yourself"
          blurb="Your written score against the ranking your choices produced. The score never feeds the rating, which is exactly why this comparison means anything."
        >
          <ul className="flex flex-col gap-1.5">
            {gaps.map((d) => (
              <li key={d.album.id}>
                <button
                  type="button"
                  onClick={() => onOpenAlbum(d.album.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-ink-800 bg-ink-900 p-2.5 text-left hover:border-ink-700"
                >
                  <AlbumThumb album={d.album} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{d.album.title}</p>
                    <p className="truncate text-xs text-ink-500">
                      #{d.rankByComparison} by your choices, #{d.rankByScore} by your score
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-ink-500">
                    {d.gap < 0 ? 'better than you say' : 'worse than you say'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {erratic.length > 0 && (
        <Section
          title="You keep changing your mind"
          blurb="Albums you have contradicted yourself on — results that went against where the album eventually landed. Ranked with Glicko-2’s volatility, shown as the contradictions themselves, which actually mean something to read."
        >
          <ul className="flex flex-col gap-1.5">
            {erratic.map((m) => (
              <li key={m.album.id}>
                <button
                  type="button"
                  onClick={() => onOpenAlbum(m.album.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-ink-800 bg-ink-900 p-2.5 text-left hover:border-ink-700"
                >
                  <AlbumThumb album={m.album} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{m.album.title}</p>
                    <p className="truncate text-xs text-ink-500">{m.album.artist}</p>
                  </div>
                  <span className="shrink-0 text-xs text-ink-500">
                    {m.upsets} of {m.decided} went the other way
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {stale.length > 0 && (
        <Section
          title="Not asked about in a while"
          blurb="Albums near the top that haven’t come up lately. Worth re-checking — an old verdict at the top of the ranking matters more than one at the bottom."
        >
          <AlbumRows albums={stale} ratings={ratings} onOpenAlbum={onOpenAlbum} detail={(r) => `${Math.round(r.rating)}`} />
        </Section>
      )}
    </div>
  )
}

function AlbumRows({
  albums,
  ratings,
  onOpenAlbum,
  detail,
}: {
  albums: Album[]
  ratings: RatingTable
  onOpenAlbum: (id: string) => void
  detail: (r: NonNullable<ReturnType<RatingTable['get']>>) => string
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {albums.map((album) => {
        const r = ratings.get(album.id)
        return (
          <li key={album.id}>
            <button
              type="button"
              onClick={() => onOpenAlbum(album.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-ink-800 bg-ink-900 p-2.5 text-left hover:border-ink-700"
            >
              <AlbumThumb album={album} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{album.title}</p>
                <p className="truncate text-xs text-ink-500">{album.artist}</p>
              </div>
              {r && <span className="shrink-0 font-mono text-xs text-ink-700">{detail(r)}</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string
  blurb: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="mt-1 text-xs text-ink-700">{blurb}</p>
      </div>
      {children}
    </section>
  )
}
