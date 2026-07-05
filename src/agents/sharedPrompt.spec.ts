import { CORE_TOOLS } from './core/tools'
import { DEFI_TOOLS } from './defi/tools'
import { buildCardBackedToolRule, SHARED_AGENT_RULES } from './sharedPrompt'
import { WALLET_TOOLS } from './wallet/tools'

describe('card-backed "do not repeat the card" rule', () => {
  describe('SHARED_AGENT_RULES — global default', () => {
    it('states the rule applies to EVERY tool (not a per-tool opt-in)', () => {
      expect(SHARED_AGENT_RULES).toMatch(/applies to EVERY tool/i)
      expect(SHARED_AGENT_RULES).toMatch(/every new tool added later/i)
    })

    it('forbids re-tabulating tool data as a hard rule', () => {
      expect(SHARED_AGENT_RULES).toMatch(/GLOBAL HARD RULE/i)
      expect(SHARED_AGENT_RULES).toMatch(/FORBIDDEN/i)
      expect(SHARED_AGENT_RULES).toMatch(/NO markdown tables/i)
    })
  })

  describe('rendersCard stamping (via composeAgentTools)', () => {
    it('stamps the DeFi opportunity/position reads that back a card', () => {
      expect(DEFI_TOOLS.defi_list_opportunities.rendersCard).toBe(true)
      expect(DEFI_TOOLS.defi_list_positions.rendersCard).toBe(true)
    })

    it('stamps wallet balance + transfer tools that back a card', () => {
      expect(WALLET_TOOLS.get_wallet_tokens.rendersCard).toBe(true)
      expect(WALLET_TOOLS.send_native_token.rendersCard).toBe(true)
    })

    it('does NOT stamp tools with no card (e.g. read_contract, estimate_gas)', () => {
      expect(WALLET_TOOLS.read_contract.rendersCard).toBeUndefined()
      expect(WALLET_TOOLS.estimate_gas.rendersCard).toBeUndefined()
    })
  })

  describe('buildCardBackedToolRule', () => {
    it('names the DeFi card-backed tools in a hard rule', () => {
      const rule = buildCardBackedToolRule(DEFI_TOOLS)
      expect(rule).toMatch(/HARD RULE/)
      expect(rule).toContain('defi_list_opportunities')
      expect(rule).not.toContain('defi_simulate_deposit') // no card
    })

    it('returns empty for an agent with no card-backed tools (Core)', () => {
      expect(buildCardBackedToolRule(CORE_TOOLS)).toBe('')
    })
  })
})
