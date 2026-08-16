/**
 * `defi_list_opportunities` / `defi_list_positions` — DeFi reads.
 *
 * Spec: docs/multi-agent-architecture-spec.md §12,
 *       docs/defi-strategies-spec.md §11.
 *
 * Mobile executor lives at `services/agent-executors/defi/reads.ts`
 * and proxies to the live `/strategies/*` backend. Schemas here
 * stay unchanged across the stub → real flip (§14.2).
 */

import { composeAgentTools } from '../../../tools/internal/compose'
import type { ToolMeta } from '../../../tools/internal/types'

const DEFI_LIST_OPPORTUNITIES: ToolMeta = {
  name: 'defi_list_opportunities',
  category: 'utility',
  executor: 'mobile',
  capability: 'read',
  description:
    'List DeFi yield opportunities, filtered by tier, chain, namespace, asset, or liquidity profile. Use for "show me where I can park USDC", "what conservative options are on Base", or "earn yield on my Sui USDC". ALWAYS call this for any "earn yield"/"where can I park X" goal — it is the single source for venue choice; pick the best row within the user\'s tier and route by its `namespace` (do NOT make the user name a protocol). Each row carries `namespace`, `chain_id`, and `protocol_slug` (the venue id used by the deposit / Sui-intent tools). Call it EXACTLY ONCE per goal. Omitting `namespace` and `chain_id` scopes the list to the wallet\'s EXACT active chain (on Base that is Base, not every EVM chain), which the device ENFORCES: a namespace you pick yourself is ignored, so probing other chains is wasted. An empty result means "nothing on this chain", not "nothing anywhere" — do not retry it elsewhere. The result reports the scope it used in `chain_scope`.',
  inputSchema: {
    type: 'object',
    properties: {
      tier: {
        type: 'string',
        enum: ['conservative', 'balanced', 'aggressive'],
        description: 'Risk tier filter.',
      },
      asset_symbol: {
        type: 'string',
        description: 'Optional asset symbol filter (e.g. "USDC").',
      },
      namespace: {
        type: 'string',
        enum: ['eip155', 'solana', 'sui', 'stellar', 'all'],
        description:
          'Chain-namespace filter. OMIT IT: the default is the wallet\'s active chain, the only chain the user can deposit from without switching or bridging. A namespace you choose on your own is IGNORED by the device and replaced with the active chain, so do not use this to probe other chains. Set "all" ONLY when the user explicitly asked to see every chain; name a single namespace ("sui", "eip155", "solana", "stellar") only when the user named that chain themselves. Never issue several calls with different namespaces to assemble a cross-chain list — use "all" once instead.',
      },
      chain_id: {
        type: 'integer',
        description:
          'EVM chain id (e.g. 8453 for Base). OMIT IT: the wallet\'s active chain is applied automatically. Set it ONLY when the user named a DIFFERENT EVM chain than the one they are on; it overrides the active-chain scope. For non-EVM, filter by `namespace` instead — Sui/Solana/Stellar rows are chain_id 0.',
        minimum: 0,
      },
      liquidity_profile: {
        type: 'string',
        enum: ['instant', 'queued_short', 'queued_long'],
        description: 'Optional liquidity profile filter.',
      },
      amount_usd: {
        type: 'number',
        description: 'Optional minimum-deposit filter, in USD.',
      },
    },
    required: [],
    additionalProperties: false,
  },
}

const DEFI_LIST_POSITIONS: ToolMeta = {
  name: 'defi_list_positions',
  category: 'utility',
  executor: 'mobile',
  capability: 'read',
  description:
    'List the connected wallet\'s open DeFi positions — protocol, chain, asset, live on-chain value, PnL, and the position\'s current APY. ALWAYS call this for "what\'s mine on X", "show my positions", "how much do I have on Compound/Aave/etc.", "what am I earning", "check my DeFi holdings", or any question about the user\'s existing deposits. Do NOT try to answer these from a wallet-balance/token-list tool — a protocol receipt token (cUSDT, aUSDC, a vault share, …) is not something the wallet\'s default token list resolves, so that path silently misses the position and produces a wrong or confused answer. The result renders as a card that already shows $ value, PnL%, and APY per row — do not re-tabulate it in prose; one short sentence at most. Also call this before routing a withdraw (see below).',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
}

export const DEFI_OPPORTUNITY_TOOLS: Record<string, ToolMeta> = composeAgentTools(
  'defi',
  {
    defi_list_opportunities: DEFI_LIST_OPPORTUNITIES,
    defi_list_positions: DEFI_LIST_POSITIONS,
  },
)
