import { clampEffort, DEFAULT_EFFORT, EFFORT_PROFILES, effortProfile } from './effort'
import { MODEL_IDS, providerOptionsFor } from './models'

describe('agents/effort', () => {
  it('high reproduces the pre-effort loop budget (16 steps, 3 failures)', () => {
    expect(EFFORT_PROFILES.high).toEqual({ maxIterations: 16, maxConsecutiveToolFailures: 3 })
    expect(effortProfile(undefined)).toBe(EFFORT_PROFILES[DEFAULT_EFFORT])
  })

  it('loop budget grows monotonically with effort', () => {
    const order = ['low', 'medium', 'high', 'xhigh', 'max'] as const
    for (let i = 1; i < order.length; i++) {
      expect(EFFORT_PROFILES[order[i]].maxIterations).toBeGreaterThanOrEqual(
        EFFORT_PROFILES[order[i - 1]].maxIterations,
      )
    }
  })

  it('clampEffort steps down to the nearest supported level', () => {
    expect(clampEffort('xhigh', ['low', 'medium', 'high', 'max'])).toBe('high')
    expect(clampEffort('max', ['low', 'medium', 'high', 'max'])).toBe('max')
    expect(clampEffort('low', ['medium'])).toBeUndefined()
    expect(clampEffort('high', [])).toBeUndefined()
  })

  it('providerOptionsFor sends native effort to Claude only', () => {
    expect(providerOptionsFor(MODEL_IDS.CLAUDE_SONNET, 'medium')).toEqual({
      anthropic: { effort: 'medium' },
    })
    // claude-sonnet-4-6 has no xhigh.
    expect(providerOptionsFor(MODEL_IDS.CLAUDE_SONNET, 'xhigh')).toEqual({
      anthropic: { effort: 'high' },
    })
    expect(providerOptionsFor(MODEL_IDS.KIMI_K2, 'high')).toBeUndefined()
    expect(providerOptionsFor(MODEL_IDS.CLAUDE_SONNET, undefined)).toBeUndefined()
  })
})
