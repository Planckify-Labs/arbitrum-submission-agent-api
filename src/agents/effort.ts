/**
 * Per-agent effort — ported from Claude Code's `/effort`.
 *
 * In Claude Code, effort is not harness logic: it is forwarded to the
 * Anthropic API as `output_config.effort` and the model decides how much to
 * think and how many tool calls to spend. We keep that, and add a HARNESS
 * half so the knob still means something on models that have no native
 * effort control (Kimi K2 today):
 *
 *   - model half   → `providerOptionsFor()` in `models.ts` (Claude only;
 *                    clamped to what the concrete model accepts).
 *   - harness half → `EFFORT_PROFILES` below: loop budget + failure spiral
 *                    tolerance, applied to every model.
 *
 * Each agent picks a level in its `config.ts`; a new agent picks its own.
 */

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export type EffortLevel = (typeof EFFORT_LEVELS)[number]

export interface EffortProfile {
  /** Hard cap on model steps in one specialist turn (protocol §7 guard). */
  maxIterations: number
  /** Consecutive all-failed tool steps before the turn is cut short. */
  maxConsecutiveToolFailures: number
}

/**
 * `high` reproduces the pre-effort defaults (16 / 3) exactly, so an agent
 * set to `high` behaves as before this module existed.
 */
export const EFFORT_PROFILES: Record<EffortLevel, EffortProfile> = {
  low: { maxIterations: 6, maxConsecutiveToolFailures: 2 },
  medium: { maxIterations: 10, maxConsecutiveToolFailures: 3 },
  high: { maxIterations: 16, maxConsecutiveToolFailures: 3 },
  xhigh: { maxIterations: 20, maxConsecutiveToolFailures: 4 },
  max: { maxIterations: 24, maxConsecutiveToolFailures: 4 },
}

/** Level used when a turn carries no explicit effort (single-agent path). */
export const DEFAULT_EFFORT: EffortLevel = 'high'

export function effortProfile(level: EffortLevel | undefined): EffortProfile {
  return EFFORT_PROFILES[level ?? DEFAULT_EFFORT]
}

/**
 * Highest level in `supported` that does not exceed `level` — e.g. `xhigh`
 * on a model that tops out at `high` becomes `high`. Returns undefined when
 * the model supports none (the model half is then a no-op).
 */
export function clampEffort(
  level: EffortLevel,
  supported: readonly EffortLevel[],
): EffortLevel | undefined {
  const rank = EFFORT_LEVELS.indexOf(level)
  for (let i = rank; i >= 0; i--) {
    if (supported.includes(EFFORT_LEVELS[i])) return EFFORT_LEVELS[i]
  }
  return undefined
}
