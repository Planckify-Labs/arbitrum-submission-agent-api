import { BRIDGE_TOOLS } from './tools/bridge'
import { DEFI_INTENT_TOOLS } from './tools/intent'
import { SWAP_TOOLS } from './tools/swap'
import { DEFI_SYSTEM_PROMPT } from './systemPrompt'

/**
 * Same-chain swaps have their own tools (swap spec §7.1): `swap_quote` →
 * `swap_execute` on EVM chains (Arc included) and Solana, while Sui keeps
 * the Intent Engine (§4.5). `bridge_*` is cross-chain only.
 *
 * The failures these guard, both seen before: the model routing a Sui swap
 * to an aggregator that skips the Sui guardian, and a tool description
 * contradicting the prompt (the old "swap on Arc = bridge_quote" clause
 * survived in three descriptions after the prompt moved on).
 */
describe('agents/defi — same-chain swap routing', () => {
  it('sends non-Sui same-chain swaps to swap_*, never bridge_*', () => {
    expect(DEFI_SYSTEM_PROMPT).toContain('### Same-chain swaps (swap_quote → swap_execute)')
    expect(DEFI_SYSTEM_PROMPT).toMatch(/NEVER `bridge_\*` for a same-chain swap/)
  })

  it('keeps Sui swaps on the Intent Engine', () => {
    expect(DEFI_SYSTEM_PROMPT).toMatch(
      /A swap ON SUI[^\n]*uses `defi_intent_preview` then `defi_intent_execute`/,
    )
    expect(DEFI_INTENT_TOOLS.defi_intent_preview.description).toMatch(/swap goal ON SUI/)
    expect(SWAP_TOOLS.swap_quote.description).toMatch(/for Sui use defi_intent_preview/)
  })

  // Tokens are looked up, never written into the prompt (swap spec §4.9,
  // B14): swap_find_token searches the catalogue and the providers, so
  // cirBTC, EURC or any routable token needs no prompt edit.
  it('names no token address or chain id, and resolves tokens with swap_find_token', () => {
    expect(DEFI_SYSTEM_PROMPT).not.toMatch(/eip155:\d+\/erc20:0x/)
    expect(DEFI_SYSTEM_PROMPT).not.toMatch(/0x[0-9a-fA-F]{40}/)
    expect(DEFI_SYSTEM_PROMPT).toMatch(/call `swap_find_token`/)
    for (const tool of Object.values(SWAP_TOOLS)) {
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(/0x[0-9a-fA-F]{40}|eip155:\d+/)
    }
  })

  it('explains amount_raw from the decimals the lookup returns', () => {
    expect(DEFI_SYSTEM_PROMPT).toMatch(/"swap 10 USDC" with 6 decimals is "10000000"/)
  })

  it('does not carry the bridge wait over to a swap', () => {
    expect(DEFI_SYSTEM_PROMPT).toMatch(/settles in seconds/)
  })

  it('never sends the user to another app when a swap cannot route', () => {
    expect(DEFI_SYSTEM_PROMPT).toMatch(/Do not suggest another app or DEX/)
  })

  it('tool descriptions agree with the prompt: bridge_* is cross-chain only', () => {
    for (const tool of [BRIDGE_TOOLS.bridge_quote, BRIDGE_TOOLS.bridge_execute, BRIDGE_TOOLS.bridge_status]) {
      expect(tool.description).not.toMatch(/same-chain Arc swap|SAME-CHAIN SWAP on Arc/i)
    }
    expect(BRIDGE_TOOLS.bridge_quote.description).toMatch(/Cross-chain ONLY/)
    expect(DEFI_INTENT_TOOLS.defi_intent_preview.description).not.toMatch(/bridge_quote/)
  })

  it('never lets the model pick the venue, slippage or recipient on a swap', () => {
    const props = Object.keys(SWAP_TOOLS.swap_execute.inputSchema.properties ?? {})
    for (const forbidden of ['to_address', 'slippage_bps', 'venue', 'dex', 'price_impact_ack_bps', 'from_address']) {
      expect(props).not.toContain(forbidden)
    }
  })
})
