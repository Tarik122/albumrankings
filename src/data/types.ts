import type { Rating } from '../rating/glicko2'

export type AlbumSource = 'manual' | 'spotify-top' | 'spotify-recent' | 'spotify-search'

/** Firestore: albums/{id}. Doc IDs are Firestore auto-IDs — see CLAUDE.md. */
export interface Album extends Rating {
  id: string
  title: string
  artist: string
  spotifyAlbumId: string | null
  artUrl: string | null
  releaseYear: number | null
  addedAt: number
  source: AlbumSource
  /**
   * Normalised "artist::title" used to deduplicate across manual adds and
   * Spotify imports. Stored so it can be queried; recomputed on write.
   */
  dedupKey: string
  comparisonCount: number
}

/** The three outcomes a comparison can record. */
export type Outcome =
  /** albumA won. */
  | 'a'
  /** albumB won. */
  | 'b'
  /** Genuinely equal — a Glicko-2 draw, s = 0.5. */
  | 'tie'
  /** No opinion available. Logged for the record, excluded from rating maths. */
  | 'skip'

/** Firestore: comparisons/{id}. Append-only; never updated, never deleted. */
export interface Comparison {
  id: string
  albumA: string
  albumB: string
  /**
   * The winning album's id, or 'tie' / 'skip'. Stored as an id (rather than
   * 'a'/'b') so the record stays meaningful even if the pair order is lost.
   */
  winner: string | 'tie' | 'skip'
  comparedAt: number
}

/** Convert a stored comparison into the outcome relative to (albumA, albumB). */
export function outcomeOf(c: Comparison): Outcome {
  if (c.winner === 'tie') return 'tie'
  if (c.winner === 'skip') return 'skip'
  if (c.winner === c.albumA) return 'a'
  if (c.winner === c.albumB) return 'b'
  // A winner id matching neither side means the log references a deleted album.
  return 'skip'
}

/** Normalise artist + title into a dedup key. */
export function makeDedupKey(artist: string, title: string): string {
  return `${normalise(artist)}::${normalise(title)}`
}

/**
 * Strip the things that differ between a manual entry and a Spotify title
 * without changing which record we mean: case, accents, punctuation, and the
 * edition suffixes Spotify appends.
 */
function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(
      /\s*[([]\s*(deluxe|expanded|remaster(ed)?|anniversary|special|legacy|bonus|super deluxe)[^)\]]*[)\]]/g,
      '',
    )
    .replace(/\s*-\s*(deluxe|expanded|remaster(ed)?|anniversary)\b.*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
