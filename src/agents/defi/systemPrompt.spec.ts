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
