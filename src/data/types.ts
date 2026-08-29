import type { Rating } from '../rating/glicko2'

export type AlbumSource =
  | 'manual'
  | 'spotify-top'
  | 'spotify-recent'
  | 'spotify-saved'
  | 'spotify-search'

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

  /**
   * Free-text review. Deliberately not part of the rating maths — it is a note
   * to yourself and to whoever reads the public page, nothing more.
   */
  review: string
  /**
   * Your own score out of 10, or null if you have not given one.
   *
   * This never feeds the rating engine. The ranking stays a pure function of
   * comparisons you actually made, so this number and the Glicko rating are two
   * independent opinions — and where they disagree is the interesting part.
   */
  personalScore: number | null
  reviewUpdatedAt: number | null

  /**
   * Whether this album appears on the public rankings page.
   *
   * The Firestore rules read this field directly, so it is the actual access
   * control for public visibility, not a UI hint. An album with this false is
   * unreadable by anyone not signed in as the owner — review included.
   */
  isPublic: boolean

  /**
   * Whether `isPublic` was actually present in the stored document.
   *
   * Derived at read time and never written back. It exists only so the one-time
   * backfill can find albums predating the field — `isPublic` itself defaults
   * to true on read, which would otherwise make them indistinguishable.
   */
  hasStoredVisibility: boolean
}

/** Fields written when an album is created, before any comparison exists. */
export const NEW_ALBUM_DEFAULTS = {
  review: '',
  personalScore: null,
  reviewUpdatedAt: null,
  isPublic: true,
} as const

/**
 * Fill in fields added after an album was first written.
 *
 * Firestore returns documents exactly as stored, so an album created before
 * reviews existed simply has no `review` key. Normalising on read keeps every
 * consumer from having to care.
 */
export function normaliseAlbum(id: string, data: Record<string, unknown>): Album {
  return {
    ...(data as Omit<Album, 'id'>),
    id,
    review: typeof data.review === 'string' ? data.review : '',
    personalScore: typeof data.personalScore === 'number' ? data.personalScore : null,
    reviewUpdatedAt: typeof data.reviewUpdatedAt === 'number' ? data.reviewUpdatedAt : null,
    // Defaults to true so an existing library becomes visible on the public page
    // rather than silently empty, matching the behaviour of a newly added album.
    isPublic: data.isPublic !== false,
    hasStoredVisibility: typeof data.isPublic === 'boolean',
  }
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
