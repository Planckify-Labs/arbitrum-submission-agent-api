import { coreCard } from '../core/card'
import { defiCard } from '../defi/card'
import { __resetRegistryForTests, registerAgent } from '../registry'
import { walletCard } from '../wallet/card'
import { CORE_HANDOFF_TOOLS } from './tools/handoff'
import { buildCoreSystemPrompt } from './systemPrompt'

/**
 * Regression guard for the bridge mis-routing incident.
 *
 * Core is a pure LLM router: it owns no tools, and the ONLY thing steering a
 * message to a specialist is the vocabulary in its prompt, the `core_handoff`
 * tool description, and each specialist's one-line card. Bridge tools live on
 * the `defi` agent (`tool_prefixes: ['defi_', 'bridge_']`) and the DeFi system
 * prompt has a full bridging section — but none of those three routing
 * surfaces mentioned "bridge" at all.
 *
 * Result: a user who had just been shown a bridge quote tapped the card's
 * "Change destination wallet" action, which sends a follow-up phrased
 * "Get me a fresh bridge quote ... using my Solana wallet "X" at <addr> as the
 * destination". Dominated by wallet-shaped words, it never reached `defi`, and
 * the user was told "I don't have access to a bridge tool ... use Jumper,
 * Mayan, or Portal" — an app telling its own user to go use a competitor, for
 * a capability it ships.
 *
 * Routing is re-decided per message with no stickiness (`orchestrate()` keeps
 * no active-agent state and `Session` has no field for one), so turn 2 cannot
 * lean on turn 1 having gone to `defi`. That makes this vocabulary the whole
 * defence.
 */
describe('agents/core systemPrompt — bridge routing', () => {
  // `specialistList()` reads the live registry, which only the app boot
  // populates — register the real cards so the prompt under test is the one
  // Core actually receives.
  let prompt: string
  beforeAll(() => {
    __resetRegistryForTests()
    registerAgent(coreCard)
    registerAgent(walletCard)
    registerAgent(defiCard)
    prompt = buildCoreSystemPrompt()
  })

  it('routes bridge / cross-chain requests to the defi specialist', () => {
    expect(prompt).toMatch(/bridge/i)
    expect(prompt).toMatch(/cross-chain/i)
    // The rule has to name the target, not just the topic.
    expect(prompt).toMatch(/bridge[\s\S]{0,400}"defi"/i)
  })

  it('states that a named destination wallet/address stays defi work', () => {
    // The exact confusion that mis-routed the follow-up to `wallet`.
    expect(prompt).toMatch(/destination/i)
    expect(prompt).toMatch(/address/i)
    expect(prompt).toMatch(/does NOT make it wallet work/i)
  })

  it('tells Core a re-quote after a wallet change is expected', () => {
    expect(prompt).toMatch(/fresh|updated|re-?quot/i)
  })

  it('exposes bridge routing on the core_handoff tool description too', () => {
    // Core sees tool descriptions as well as its system prompt; both steered
    // it away from defi before, so both are asserted.
    const handoff = CORE_HANDOFF_TOOLS.core_handoff
    expect(handoff).toBeDefined()
    expect(handoff.description).toMatch(/bridge/i)
    expect(handoff.description).toMatch(/"defi"/)
  })

  it('advertises bridging in the defi card Core reads when listing specialists', () => {
    expect(defiCard.description).toMatch(/bridg/i)
    expect(defiCard.tool_prefixes).toContain('bridge_')
    // The card is interpolated into Core's prompt via specialistList().
    expect(prompt).toContain(defiCard.description)
  })
})

/**
 * Regression guard for the "show my defi position" mis-routing incident.
 *
 * Same class of bug as the bridge incident above, one layer up: Core's own
 * routing vocabulary listed DeFi triggers as action-only ("swap", "earn
 * yield", "supply"/"withdraw") and separately bucketed "balance / token"
 * requests into "wallet" with nothing excluding a DeFi position check from
 * that bucket. "Show my defi position" / "what's mine on Compound" reads
 * exactly like a balance question, so the SAME message routed
 * inconsistently turn to turn — sometimes correctly to "defi"
 * (`defi_list_positions`, which shows the real position with value/PnL/
 * APY), sometimes to "wallet", which has no such tool and told the user
 * "I don't have access to a tool that can scan and display your full DeFi
 * positions ... use DeBank, Zapper" — the exact same class of "tell the
 * user to go use a competitor" failure as the bridge incident, for a
 * capability the app ships.
 */
describe('agents/core systemPrompt — DeFi position-check routing', () => {
  let prompt: string
  beforeAll(() => {
    __resetRegistryForTests()
    registerAgent(coreCard)
    registerAgent(walletCard)
    registerAgent(defiCard)
    prompt = buildCoreSystemPrompt()
  })

  it('routes an existing-DeFi-position check to the defi specialist, not wallet', () => {
    expect(prompt).toMatch(/existing DeFi position/i)
    expect(prompt).toMatch(/what's mine on/i)
    // The rule has to name the target, not just the topic.
    expect(prompt).toMatch(/existing DeFi position[\s\S]{0,400}"defi"/i)
  })

  it('explicitly excludes a DeFi position check from the wallet balance bucket', () => {
    expect(prompt).toMatch(/not deposited into a protocol/i)
  })

  it('explains why it reads like a balance question but is not wallet work', () => {
    expect(prompt).toMatch(/receipt token/i)
  })

  it('exposes DeFi position-check routing on the core_handoff tool description too', () => {
    const handoff = CORE_HANDOFF_TOOLS.core_handoff
    expect(handoff.description).toMatch(/existing DeFi position/i)
    expect(handoff.description).toMatch(/receipt token/i)
  })
})
