/**
 * Glicko-2, implemented from Glickman's specification ("Example of the Glicko-2
 * system", glicko.net/glicko/glicko2.pdf).
 *
 * This module is pure maths: no Firestore, no app types, no side effects. It
 * operates on *rating periods* — batches of results — which is how Glicko-2 is
 * actually defined. Feeding it one result at a time is possible (a period of
 * length 1) but degrades the volatility estimate, which is the whole reason we
 * chose Glicko-2 over Elo. See engine.ts for how periods are formed.
 */

/** Glickman's scale conversion constant: 173.7178 = 400 / ln(10). */
const SCALE = 173.7178

/** Ratings are reported on the familiar ~1500-centred scale. */
export const DEFAULT_RATING = 1500
export const DEFAULT_RD = 350
export const DEFAULT_VOLATILITY = 0.06

/** Convergence tolerance for the volatility solver. */
const EPSILON = 0.000001

export interface Rating {
  /** Rating (μ) on the display scale, ~1500-centred. */
  rating: number
  /** Rating deviation (RD) on the display scale. Uncertainty; lower = more confident. */
  ratingDeviation: number
  /** Volatility (σ). How erratic this album's results have been. */
  volatility: number
}

/** One result inside a rating period, from the perspective of the album being updated. */
export interface Result {
  /** The opponent's rating at the *start* of the period (Glicko-2 requires this). */
  opponent: Rating
  /** Score: 1 = this album won, 0 = it lost, 0.5 = draw. */
  score: number
}

export interface Glicko2Config {
  /**
   * System constant τ, constraining how much volatility can change per period.
   * Glickman suggests 0.3–1.2; smaller values make ratings steadier against a
   * single surprising result. We default low because our results come from one
   * fallible human rather than tournament play.
   */
  tau: number
  /**
   * Multiplier on the idle-period RD inflation. Standard Glicko-2 uses 1.0
   * because player skill drifts while inactive. Album quality does not drift —
   * only the listener's opinion does, far more slowly — so we damp this. See
   * engine.ts for the full reasoning.
   */
  idleInflation: number
  /** Ceiling on RD for albums with an established record, to stop idle drift. */
  maxEstablishedRd: number
  /** Comparison count at which an album counts as "established". */
  establishedAfter: number
}

export const DEFAULT_CONFIG: Glicko2Config = {
  tau: 0.5,
  idleInflation: 0.15,
  maxEstablishedRd: 150,
  establishedAfter: 5,
}

export function defaultRating(): Rating {
  return {
    rating: DEFAULT_RATING,
    ratingDeviation: DEFAULT_RD,
    volatility: DEFAULT_VOLATILITY,
  }
}

/** Step 2: convert display scale (r, RD) to the internal Glicko-2 scale (μ, φ). */
function toGlicko2Scale(r: Rating): { mu: number; phi: number; sigma: number } {
  return {
    mu: (r.rating - DEFAULT_RATING) / SCALE,
    phi: r.ratingDeviation / SCALE,
    sigma: r.volatility,
  }
}

/** Step 8: convert back to the display scale. */
function fromGlicko2Scale(mu: number, phi: number, sigma: number): Rating {
  return {
    rating: SCALE * mu + DEFAULT_RATING,
    ratingDeviation: SCALE * phi,
    volatility: sigma,
  }
}

/** g(φ): weights an opponent's influence by how well-known their rating is. */
function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI))
}

/** E(μ, μ_j, φ_j): expected score against one opponent. */
function expectedScore(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)))
}

/**
 * Fisher information carried by a single comparison, in internal-scale units.
 *
 * This is the per-opponent term of Glicko-2's own variance estimate v, and it
 * peaks when the outcome is genuinely uncertain (E ≈ 0.5) against a
 * well-determined opponent. Matchmaking reuses it directly as the "how much
 * will this pair teach me" score — see matchmaking.ts.
 */
export function comparisonInformation(a: Rating, b: Rating): number {
  const ga = toGlicko2Scale(a)
  const gb = toGlicko2Scale(b)
  const gPhi = g(gb.phi)
  const e = expectedScore(ga.mu, gb.mu, gb.phi)
  return gPhi * gPhi * e * (1 - e)
}

/** Probability that `a` beats `b`, on the display scale. Used by the UI. */
export function winProbability(a: Rating, b: Rating): number {
  const ga = toGlicko2Scale(a)
  const gb = toGlicko2Scale(b)
  // Combine both deviations so a matchup involving an unknown album is
  // reported as closer to a coin-flip than the raw ratings suggest.
  const combinedPhi = Math.sqrt(ga.phi * ga.phi + gb.phi * gb.phi)
  return 1 / (1 + Math.exp(-g(combinedPhi) * (ga.mu - gb.mu)))
}

/**
 * Step 5: solve for the new volatility σ' using the Illinois variant of regula
 * falsi, exactly as in Glickman's paper.
 */
function solveVolatility(
  sigma: number,
  phi: number,
  v: number,
  delta: number,
  tau: number,
): number {
  const a = Math.log(sigma * sigma)
  const phiSq = phi * phi
  const deltaSq = delta * delta

  const f = (x: number): number => {
    const ex = Math.exp(x)
    const num = ex * (deltaSq - phiSq - v - ex)
    const den = 2 * Math.pow(phiSq + v + ex, 2)
    return num / den - (x - a) / (tau * tau)
  }

  // Bracket the root.
  let A = a
  let B: number
  if (deltaSq > phiSq + v) {
    B = Math.log(deltaSq - phiSq - v)
  } else {
    let k = 1
    while (f(a - k * tau) < 0) {
      k += 1
      // Guard against a pathological config making this loop forever.
      if (k > 100) break
    }
    B = a - k * tau
  }

  let fA = f(A)
  let fB = f(B)

  let guard = 0
  while (Math.abs(B - A) > EPSILON && guard < 1000) {
    const C = A + ((A - B) * fA) / (fB - fA)
    const fC = f(C)
    if (fC * fB <= 0) {
      A = B
      fA = fB
    } else {
      fA = fA / 2
    }
    B = C
    fB = fC
    guard += 1
  }

  return Math.exp(A / 2)
}

/**
 * Apply one rating period's worth of results to a single album.
 *
 * `results` may be empty, which is the "did not compete this period" case:
 * Glicko-2 then only inflates RD. Callers pass `comparisonCount` (total, before
 * this period) so the established-album RD ceiling can be applied.
 */
export function updateRating(
  current: Rating,
  results: Result[],
  config: Glicko2Config = DEFAULT_CONFIG,
  comparisonCount = 0,
): Rating {
  const { mu, phi, sigma } = toGlicko2Scale(current)

  if (results.length === 0) {
    // Step 6 applied alone: uncertainty grows during inactivity. We damp this
    // heavily — an album's quality is fixed, so an unplayed period tells us far
    // less than it would about a chess player whose skill is drifting.
    const inflated = Math.sqrt(phi * phi + Math.pow(config.idleInflation * sigma, 2))
    const next = fromGlicko2Scale(mu, inflated, sigma)
    return capRd(next, config, comparisonCount)
  }

  // Steps 3 and 4: estimated variance v, and the estimated improvement Δ.
  let vInv = 0
  let deltaSum = 0
  for (const { opponent, score } of results) {
    const o = toGlicko2Scale(opponent)
    const gPhi = g(o.phi)
    const e = expectedScore(mu, o.mu, o.phi)
    vInv += gPhi * gPhi * e * (1 - e)
    deltaSum += gPhi * (score - e)
  }
  const v = 1 / vInv
  const delta = v * deltaSum

  // Step 5: new volatility.
  const sigmaPrime = solveVolatility(sigma, phi, v, delta, config.tau)

  // Steps 6 and 7: pre-period RD inflation, then the post-period update.
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime)
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v)
  const muPrime = mu + phiPrime * phiPrime * deltaSum

  const next = fromGlicko2Scale(muPrime, phiPrime, sigmaPrime)
  return capRd(next, config, comparisonCount + results.length)
}

/**
 * Hold RD below a ceiling once an album has a real record, and never let it
 * exceed the initial 350 for anything.
 */
function capRd(r: Rating, config: Glicko2Config, comparisonCount: number): Rating {
  const ceiling =
    comparisonCount >= config.establishedAfter ? config.maxEstablishedRd : DEFAULT_RD
  return r.ratingDeviation > ceiling ? { ...r, ratingDeviation: ceiling } : r
}

/**
 * A conservative, comparable score for leaderboard ordering: the bottom of the
 * album's 95% confidence interval. An album that has won twice sits below one
 * with the same rating and forty comparisons behind it, which is the honest
 * ordering.
 */
export function conservativeRating(r: Rating): number {
  return r.rating - 2 * r.ratingDeviation
}
