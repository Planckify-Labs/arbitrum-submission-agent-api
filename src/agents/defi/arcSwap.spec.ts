import { BRIDGE_TOOLS } from './tools/bridge'
import { DEFI_INTENT_TOOLS } from './tools/intent'
import { DEFI_SYSTEM_PROMPT } from './systemPrompt'

/**
 * Swaps on Arc go through Tower Exchange, docked into the bridge surface as
 * a SAME-CHAIN route (api `src/bridge/providers/tower.adapter.ts`). The
 * model has to reach it through `bridge_quote` with the same Arc chain on
 * both sides.
 *
 * The failure these guard: `defi_intent_preview` says "ALWAYS call this
 * tool for a swap goal", and it compiles Sui transactions only. Without an
 * explicit Arc route the model would send an Arc swap there and get
 * `unsupported`, or refuse and recommend another DEX.
 */
describe('agents/defi — swaps on Arc', () => {
  it('routes an Arc swap through bridge_quote with one chain on both sides', () => {
    expect(DEFI_SYSTEM_PROMPT).toContain('### Swaps on Arc')
    expect(DEFI_SYSTEM_PROMPT).toMatch(
      /`from_chain` AND `to_chain` BOTH set to that Arc chain/,
    )
    expect(DEFI_SYSTEM_PROMPT).toMatch(
      /NEVER use `defi_intent_preview` \/ `defi_intent_execute` on Arc/,
    )
  })

  // The defi agent has no token lookup tool, so a wrong address or decimal
  // here is a wrong swap. These must match the api adapter and Tower.
  it('pins the Arc token ids and decimals the api adapter expects', () => {
    for (const id of [
      'eip155:5042/erc20:0x3600000000000000000000000000000000000000',
      'eip155:5042/erc20:0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1',
      'eip155:5042002/erc20:0x3600000000000000000000000000000000000000',
      'eip155:5042002/erc20:0x89b50855aa3be2f677cd6303cec089b5f319d72a',
    ]) {
      expect(DEFI_SYSTEM_PROMPT).toContain(id)
    }
    expect(DEFI_SYSTEM_PROMPT).toMatch(
      /"swap 10 USDC to EURC" is `amount_raw` "10000000"/,
    )
  })

  it('does not carry the bridge wait over to a swap', () => {
    expect(DEFI_SYSTEM_PROMPT).toMatch(/settles in seconds/)
  })

  it('never sends the user to another app when Arc cannot route', () => {
    expect(DEFI_SYSTEM_PROMPT).toMatch(/Do not suggest another app or DEX/)
  })

  it('keeps the tool descriptions consistent with the prompt', () => {
    expect(BRIDGE_TOOLS.bridge_quote.description).toMatch(
      /SAME-CHAIN SWAP on Arc/,
    )
    expect(BRIDGE_TOOLS.bridge_execute.description).toMatch(
      /same-chain Arc swap/i,
    )
    expect(DEFI_INTENT_TOOLS.defi_intent_preview.description).toMatch(
      /swap goal ON SUI/,
    )
    expect(DEFI_INTENT_TOOLS.defi_intent_preview.description).toMatch(
      /Sui ONLY: a swap on Arc goes through bridge_quote/,
    )
  })
})
