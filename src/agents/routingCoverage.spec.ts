import { AGENT_CONFIGS, listSpecialistIds } from './agentConfig'
import { defiCard } from './defi/card'
import type { AgentCard } from './types'
import { walletCard } from './wallet/card'
import { scopeToolsForModel } from './wallet/tools/namespaceScope'

/**
 * Core routes from each card's `routing` lines. A tool the model can call
 * but that no routing line mentions is a capability Core does not know
 * about: it answers "I can't do that" and never hands off. That shipped
 * twice (NFTs after get_wallet_nfts, game top-ups for redemption). These
 * checks make the next one a CI failure.
 */

const NAMESPACES = ['eip155', 'solana', 'sui', 'stellar'] as const
const CARDS: Record<string, AgentCard> = { wallet: walletCard, defi: defiCard }

/** Tools the model can actually see on any namespace. */
function modelVisibleTools(tools: Record<string, unknown>): Set<string> {
  const out = new Set<string>()
  for (const ns of NAMESPACES) {
    for (const name of Object.keys(scopeToolsForModel(tools as never, ns))) out.add(name)
  }
  return out
}

export function uncoveredTools(card: AgentCard, visible: Set<string>): string[] {
  const covered = new Set((card.routing ?? []).flatMap((r) => r.tools))
  return [...visible].filter((t) => !covered.has(t)).sort()
}

describe('routing coverage', () => {
  it('every specialist has a card with routing lines', () => {
    for (const id of listSpecialistIds()) {
      expect({ id, lines: (CARDS[id]?.routing ?? []).length > 0 }).toEqual({ id, lines: true })
    }
  })

  for (const id of listSpecialistIds()) {
    it(`${id}: every model-visible tool is covered by a routing line`, () => {
      const visible = modelVisibleTools(AGENT_CONFIGS[id].tools)
      expect({ id, uncovered: uncoveredTools(CARDS[id], visible) }).toEqual({ id, uncovered: [] })
    })

    it(`${id}: routing lines name only tools the agent owns`, () => {
      const owned = new Set(Object.keys(AGENT_CONFIGS[id].tools))
      const stale = (CARDS[id].routing ?? []).flatMap((r) => r.tools).filter((t) => !owned.has(t))
      expect({ id, stale }).toEqual({ id, stale: [] })
    })
  }

  it('fails on drift: a visible tool missing from routing is reported', () => {
    const card: AgentCard = { ...walletCard, routing: [{ handles: 'balances', tools: ['get_wallet_assets'] }] }
    expect(uncoveredTools(card, new Set(['get_wallet_assets', 'get_wallet_nfts']))).toEqual(['get_wallet_nfts'])
  })
})
