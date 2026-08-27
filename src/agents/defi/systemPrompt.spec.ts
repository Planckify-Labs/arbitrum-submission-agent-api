import { BRIDGE_TOOLS } from './tools/bridge'
import { DEFI_OPPORTUNITY_TOOLS } from './tools/opportunities'
import { DEFI_SYSTEM_PROMPT } from './systemPrompt'

/**
 * Regression guard for the swap-hallucination incident, now owned by the
 * DeFi agent (it owns the swap tools, so this is the prompt the model reads
 * when it runs a swap). The agent claimed a swap executed after calling only
 * `defi_intent_preview` (a read that signs nothing / moves no funds) and
 * never calling `defi_intent_execute` — no approval sheet, no funds moved,
 * yet a false "done". These assertions keep the guardrails from regressing.
 */
describe('agents/defi systemPrompt — swap honesty + two-step flow', () => {
  it('describes the two-step preview→execute flow', () => {
    expect(DEFI_SYSTEM_PROMPT).toContain('defi_intent_preview')
    expect(DEFI_SYSTEM_PROMPT).toContain('defi_intent_execute')
    expect(DEFI_SYSTEM_PROMPT).toMatch(/signs?\s+NOTHING/i)
    expect(DEFI_SYSTEM_PROMPT).toMatch(/moves?\s+NO funds/i)
    expect(DEFI_SYSTEM_PROMPT).toMatch(/MUST call .?defi_intent_execute/i)
  })

  it('forbids claiming success without an execute result', () => {
    expect(DEFI_SYSTEM_PROMPT).toContain('On-chain execution honesty')
    for (const word of ['executed', 'broadcast', 'successful']) {
      expect(DEFI_SYSTEM_PROMPT.toLowerCase()).toContain(word)
    }
    expect(DEFI_SYSTEM_PROMPT).toMatch(/digest/i)
  })

  it('includes the shared cross-cutting rules', () => {
    expect(DEFI_SYSTEM_PROMPT).toContain('### Privacy')
    expect(DEFI_SYSTEM_PROMPT).toContain('### Honesty')
  })
})

/**
 * Regression guard for the "I need your Solana address" dead end.
 *
 * `bridge_quote`'s schema used to say `to_address` was REQUIRED for a
 * cross-namespace bridge. The device had since gained the ability to
 * resolve the user's own wallet on the destination chain and show it on
 * the card, but the tool description still said otherwise — so the model
 * dutifully refused to call the tool and asked the user to paste an
 * address it was already holding. The user asked twice and got the same
 * question both times.
 *
 * Two lessons encoded here: a stale TOOL DESCRIPTION is as behaviour-
 * changing as stale code, and asking a user to hand-type their own
 * address is both bad UX and a typo away from an irreversible loss.
 */
describe('agents/defi systemPrompt — bridge destination resolution', () => {
  it('forbids asking the user for their own destination address', () => {
    expect(DEFI_SYSTEM_PROMPT).toMatch(
      /NEVER ask the user for their own destination address/i,
    )
  })

  it('tells the model to omit to_address and let the device resolve it', () => {
    expect(DEFI_SYSTEM_PROMPT).toMatch(/OMIT .?to_address/i)
    expect(DEFI_SYSTEM_PROMPT).toMatch(/resolves the destination itself/i)
  })

  it('names the card as the confirmation step, not a chat question', () => {
    expect(DEFI_SYSTEM_PROMPT).toMatch(/card.{0,120}change it/is)
  })

  // The schema is the other surface the model reads; both must agree, or
  // the stricter one wins and the dead end comes back.
  it('keeps the tool schema consistent with the prompt', () => {
    const toAddress = BRIDGE_TOOLS.bridge_quote.inputSchema?.properties
      ?.to_address as { description?: string } | undefined
    expect(toAddress?.description).toBeDefined()
    expect(toAddress?.description).toMatch(/OMIT IT/i)
    expect(toAddress?.description).toMatch(/NEVER ask the user/i)
    // The old wording that caused the dead end must not come back.
    expect(toAddress?.description).not.toMatch(/REQUIRED when the destination/i)
  })

  it('never marks to_address as a required argument', () => {
    for (const tool of ['bridge_quote', 'bridge_execute'] as const) {
      expect(BRIDGE_TOOLS[tool].inputSchema?.required ?? []).not.toContain(
        'to_address',
      )
    }
  })
})

/**
 * Regression guard for the "what's mine on Compound?" incident: the agent
 * had `defi_list_positions` available but never called it for a "what's
 * mine" question, so it improvised an answer from raw wallet-token
 * balances and missed the position entirely (Compound III's cUSDT receipt
 * token isn't in the wallet's default token list). Both the tool
 * description and the system prompt now say explicitly when to call it.
 */
describe('agents/defi systemPrompt — position-check routing', () => {
  it('tells the model to call defi_list_positions for "what\'s mine" questions', () => {
    expect(DEFI_SYSTEM_PROMPT).toContain('Checking positions')
    expect(DEFI_SYSTEM_PROMPT).toMatch(/what's mine/i)
    expect(DEFI_SYSTEM_PROMPT).toContain('defi_list_positions')
  })

  it('forbids answering a position question from a wallet-balance tool', () => {
    expect(DEFI_SYSTEM_PROMPT).toMatch(/NEVER answer from a wallet-balance/i)
  })

  it('keeps the tool description consistent with the prompt', () => {
    const description = DEFI_OPPORTUNITY_TOOLS.defi_list_positions?.description
    expect(description).toBeDefined()
    expect(description).toMatch(/what's mine/i)
    expect(description).toMatch(/ALWAYS call this/i)
  })
})

/**
 * Quick Invest Phase 1 (mobile-app docs/defi-quick-invest-spec.md §8).
 *
 * `amount_usd` and `tier` were documented purely as filters, so the model
 * only passed them when it was consciously narrowing a list. The card now
 * ALSO uses them to decide what it opens showing — a user who said "invest
 * $750, balanced" and got neither field forwarded lands on the same
 * generic recommendation as someone who said nothing at all.
 *
 * The paired negative assertion matters as much as the positive one: an
 * `amount_usd` the model invented renders to the user as a pre-filled
 * deposit amount, which is a financial suggestion this app must not make
 * on its own.
 */
describe('agents/defi systemPrompt — Quick Invest intent forwarding', () => {
  it('tells the model to forward a stated amount and tier', () => {
    expect(DEFI_SYSTEM_PROMPT).toMatch(
      /Pass .?amount_usd.? and .?tier.? WHENEVER the user has stated them/i,
    )
    expect(DEFI_SYSTEM_PROMPT).toContain('invest $750, balanced')
  })

  it('tells the model to infer tier from a goal', () => {
    expect(DEFI_SYSTEM_PROMPT).toMatch(/emergency fund/i)
    expect(DEFI_SYSTEM_PROMPT).toMatch(/conservative/i)
    expect(DEFI_SYSTEM_PROMPT).toMatch(/aggressive/i)
  })

  it('forbids inventing an amount the user never said', () => {
    expect(DEFI_SYSTEM_PROMPT).toMatch(
      /NEVER invent an .?amount_usd.? the user did not say/i,
    )
  })

  it('keeps the tool schema consistent with the prompt', () => {
    const schema = DEFI_OPPORTUNITY_TOOLS.defi_list_opportunities
      ?.inputSchema as {
      properties?: Record<string, { description?: string }>
    }
    const amount = schema?.properties?.amount_usd?.description
    const tier = schema?.properties?.tier?.description
    expect(amount).toMatch(/PASS IT WHENEVER THE USER NAMES A NUMBER/)
    // The filtering behaviour is real and load-bearing; the rewrite adds a
    // second use rather than replacing the first.
    expect(amount).toMatch(/minimum deposit/i)
    expect(tier).toMatch(/goal/i)
  })
})

/**
 * DCA v1 (mobile-app docs/defi-quick-invest-spec.md §12).
 *
 * The single most damaging thing the model could say about this feature is
 * that it invests automatically. It does not: the server nudges, the user
 * taps, the user's own key signs. Claiming otherwise would describe a
 * standing financial authority the app deliberately does not hold (§13 is
 * unbuilt and needs its own security review), and a user who believed it
 * would think money was moving when nothing was.
 */
describe('agents/defi systemPrompt — recurring investing is a reminder', () => {
  it('frames DCA as a reminder the user still signs', () => {
    expect(DEFI_SYSTEM_PROMPT).toContain('defi_set_recurring_invest')
    expect(DEFI_SYSTEM_PROMPT).toMatch(/REMINDER/)
    expect(DEFI_SYSTEM_PROMPT).toMatch(/signs? the deposit themselves/i)
  })

  it('forbids describing it as automatic', () => {
    expect(DEFI_SYSTEM_PROMPT).toMatch(/NEVER describe it as "automatic"/i)
    expect(DEFI_SYSTEM_PROMPT).toMatch(/MOVES NO FUNDS TODAY/)
  })

  it('forbids inventing an amount or a cadence', () => {
    expect(DEFI_SYSTEM_PROMPT).toMatch(
      /Do NOT invent an .?amount_usd.? or a .?cadence.?/,
    )
  })

  it('requires surfacing a saved-strategy tier override', () => {
    expect(DEFI_SYSTEM_PROMPT).toContain('defi_list_recurring_invest')
    expect(DEFI_SYSTEM_PROMPT).toMatch(/Never let that override happen silently/i)
  })
})

/**
 * Regression guard for a contradiction seen on device: the opportunity card
 * rendered "these sit outside your risk profile, so we haven't built a plan
 * from them" and the agent, in the same turn, proposed a deposit into one of
 * exactly those pools. The card refused and the agent routed around it.
 */
describe('agents/defi systemPrompt — out-of-tier rows are informational', () => {
  it('forbids proposing a row flagged outside_tier', () => {
    expect(DEFI_SYSTEM_PROMPT).toContain('outside_tier')
    expect(DEFI_SYSTEM_PROMPT).toMatch(/NEVER propose one/i)
  })

  it('says the same in the tool description', () => {
    const description =
      DEFI_OPPORTUNITY_TOOLS.defi_list_opportunities?.description
    expect(description).toContain('outside_tier')
    expect(description).toMatch(/NEVER propose a deposit into one/i)
  })
})
