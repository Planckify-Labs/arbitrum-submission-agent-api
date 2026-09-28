import { decideCoreRoute, redirectBrief } from './engine'

describe('agents/engine decideCoreRoute', () => {
  const specialists = ['defi', 'wallet'] as const

  it('routes a valid core_handoff to a single step', () => {
    const decision = decideCoreRoute(
      [
        {
          toolName: 'core_handoff',
          input: { to: 'defi', brief: 'swap 2 SUI' },
        },
      ],
      specialists,
    )
    expect(decision).toEqual({
      kind: 'route',
      steps: [{ to: 'defi', brief: 'swap 2 SUI' }],
    })
  })

  // The regression this round targets: a compound request emits several
  // hand-offs in ONE response; every one must be kept, in order.
  it('collects MULTIPLE hand-offs into ordered steps', () => {
    const decision = decideCoreRoute(
      [
        {
          toolName: 'core_handoff',
          input: { to: 'wallet', brief: 'show balance' },
        },
        {
          toolName: 'core_handoff',
          input: { to: 'defi', brief: 'swap 1.1 SUI' },
        },
      ],
      specialists,
    )
    expect(decision).toEqual({
      kind: 'route',
      steps: [
        { to: 'wallet', brief: 'show balance' },
        { to: 'defi', brief: 'swap 1.1 SUI' },
      ],
    })
  })

  it('keeps valid steps and skips invalid targets', () => {
    const decision = decideCoreRoute(
      [
        { toolName: 'core_handoff', input: { to: 'ghost', brief: 'x' } },
        { toolName: 'core_handoff', input: { to: 'wallet', brief: 'balance' } },
      ],
      specialists,
    )
    expect(decision).toEqual({
      kind: 'route',
      steps: [{ to: 'wallet', brief: 'balance' }],
    })
  })

  it('treats an unknown-only specialist id as answered (no valid step)', () => {
    const decision = decideCoreRoute(
      [{ toolName: 'core_handoff', input: { to: 'ghost', brief: 'x' } }],
      specialists,
    )
    expect(decision.kind).toBe('answered')
  })

  it('treats core_clarify as answered when there is no user request to forward', () => {
    const decision = decideCoreRoute(
      [{ toolName: 'core_clarify', input: { question: 'which token?' } }],
      specialists,
    )
    expect(decision.kind).toBe('answered')
  })

  // Clarify gate — the "Send $50 to mom" regression. Core has no tools, so a
  // detail question from it is redirected to the specialist that can look.
  describe('clarify gate', () => {
    const user = 'Send $50 to mom'

    it('redirects a missing_detail clarify to likely_agent with the user’s words', () => {
      const decision = decideCoreRoute(
        [
          {
            toolName: 'core_clarify',
            input: {
              kind: 'missing_detail',
              likely_agent: 'wallet',
              question: 'Which token, and is your mom in your address book?',
            },
          },
        ],
        specialists,
        user,
      )
      expect(decision).toEqual({
        kind: 'route',
        steps: [{ to: 'wallet', brief: redirectBrief(user) }],
        redirectedFromClarify: true,
      })
      expect(redirectBrief(user)).toContain('"Send $50 to mom"')
    })

    it('also redirects when the model omits kind but names an agent', () => {
      const decision = decideCoreRoute(
        [{ toolName: 'core_clarify', input: { likely_agent: 'wallet', question: 'which token?' } }],
        specialists,
        user,
      )
      expect(decision.kind).toBe('route')
    })

    it('asks a which_task question verbatim', () => {
      const decision = decideCoreRoute(
        [
          {
            toolName: 'core_clarify',
            input: { kind: 'which_task', likely_agent: 'wallet', question: 'What would you like to do?' },
          },
        ],
        specialists,
        'do the thing',
      )
      expect(decision.kind).toBe('answered')
    })

    it('asks when likely_agent is missing or unknown — never a silent drop', () => {
      for (const likely_agent of [undefined, 'ghost']) {
        const decision = decideCoreRoute(
          [{ toolName: 'core_clarify', input: { kind: 'missing_detail', likely_agent, question: 'q?' } }],
          specialists,
          user,
        )
        expect(decision.kind).toBe('answered')
      }
    })

    it('a real hand-off wins over a clarify in the same response', () => {
      const decision = decideCoreRoute(
        [
          { toolName: 'core_clarify', input: { kind: 'missing_detail', likely_agent: 'defi', question: 'q?' } },
          { toolName: 'core_handoff', input: { to: 'wallet', brief: 'send $50 to mom' } },
        ],
        specialists,
        user,
      )
      expect(decision).toEqual({ kind: 'route', steps: [{ to: 'wallet', brief: 'send $50 to mom' }] })
    })
  })

  it('treats no tool calls as answered', () => {
    expect(decideCoreRoute([], specialists).kind).toBe('answered')
  })

  it('defaults a missing brief to an empty string', () => {
    const decision = decideCoreRoute(
      [{ toolName: 'core_handoff', input: { to: 'wallet' } }],
      specialists,
    )
    expect(decision).toEqual({
      kind: 'route',
      steps: [{ to: 'wallet', brief: '' }],
    })
  })
})
