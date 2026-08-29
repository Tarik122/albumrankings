import type { Album } from '../data/types'

interface Props {
  album: Album
  onPick: () => void
  disabled: boolean
  /** Keyboard hint shown in the corner. */
  shortcut: string
}

/** One side of a comparison: big, clickable, art-forward. */
export function ComparisonCard({ album, onPick, disabled, shortcut }: Props) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className="group relative flex w-full flex-col overflow-hidden rounded-2xl border border-ink-800 bg-ink-900 text-left transition enabled:hover:border-accent-dim enabled:hover:bg-ink-800 disabled:opacity-60"
    >
      <div className="relative aspect-square w-full bg-ink-800">
        {album.artUrl ? (
          <img
            src={album.artUrl}
            alt=""
            className="h-full w-full object-cover transition group-enabled:group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-6xl font-semibold text-ink-700">
            {/* A monogram rather than the title, which already sits below. */}
            {album.title.trim().charAt(0).toUpperCase() || '?'}
          </div>
        )}
        <span className="absolute top-3 right-3 rounded-md bg-ink-950/80 px-2 py-1 font-mono text-xs text-ink-300">
          {shortcut}
        </span>
      </div>
      <div className="flex flex-col gap-1 p-4">
        <span className="text-base leading-tight font-semibold text-white">{album.title}</span>
        <span className="text-sm text-ink-500">
          {album.artist}
          {album.releaseYear ? ` · ${album.releaseYear}` : ''}
        </span>
      </div>
    </button>
  )
}

/** Compact row used by the leaderboard and library list. */
export function AlbumThumb({ album, size = 'h-12 w-12' }: { album: Album; size?: string }) {
  return album.artUrl ? (
    <img src={album.artUrl} alt="" className={`${size} shrink-0 rounded object-cover`} loading="lazy" />
  ) : (
    <div className={`${size} shrink-0 rounded bg-ink-800`} />
  )
}
