/**
 * DeFi agent — ready.
 *
 * Spec reference: docs/multi-agent-architecture-spec.md §5, §12, §14.2;
 * docs/defi-strategies-spec.md §11.
 *
 * Reads (`defi_list_opportunities`, `defi_list_positions`) wire through
 * to the live `/strategies/*` backend in `api/src/strategies/`.
 * Writes (`defi_deposit` / `defi_withdraw` / `defi_rebalance` /
 * `defi_cross_chain_deposit`) currently surface a `not_implemented`
 * error until the on-chain adapter set in
 * `services/defi/adapters/*` is built out.
 */

import type { AgentCard } from '../types'

export const defiCard: AgentCard = {
  id: 'defi',
  version: '0.1.0',
  display_name: 'DeFi specialist',
  description:
    'Owns yield strategies, opportunity discovery, rebalances, position reads, ' +
    'and BRIDGING assets across chains (quote, execute, status) — including ' +
    'when the request names a destination wallet or address.',
  routing: [
    {
      handles: 'earning yield: where to invest, deposits, recurring (DCA) investing plans',
      tools: [
        'defi_list_opportunities',
        'defi_get_config',
        'defi_simulate_deposit',
        'defi_deposit',
        'defi_cross_chain_deposit',
        'defi_set_recurring_invest',
        'defi_list_recurring_invest',
      ],
    },
    {
      handles:
        'existing DeFi positions ("what\'s mine on Compound", earnings), withdrawing, rebalancing, claiming or compounding rewards',
      tools: ['defi_list_positions', 'defi_withdraw', 'defi_rebalance', 'defi_claim', 'defi_compound'],
    },
    {
      handles: 'swapping one token for another on the same chain',
      tools: ['swap_find_token', 'swap_quote', 'swap_execute', 'swap_status', 'defi_intent_preview', 'defi_intent_execute'],
    },
    {
      handles: 'bridging / moving assets between chains (quote, execute, status, receiving on the destination)',
      tools: ['bridge_get_support', 'bridge_quote', 'bridge_execute', 'bridge_status', 'bridge_claim'],
    },
  ],
  tool_prefixes: ['defi_', 'bridge_', 'swap_'],
  capabilities: [
    'yield_discovery',
    'position_read',
    'deposit',
    'withdraw',
    'rebalance',
    // General-purpose cross-chain transfer (bridge-capability-spec §8.3).
    // Standalone, not welded to a deposit: moving USDC from Base to
    // Arbitrum is a goal in its own right.
    'bridge',
    // Standalone same-chain swap (swap-capability-spec §7).
    'swap',
  ],
  requires_wallet_context: true,
  requires_jwt: true,
  default_system_prompt_ref: 'defi.v1',
  status: 'ready',
}
