/**
 * `bridge_*` — the general-purpose bridge capability.
 *
 * Spec: docs/bridge-capability-spec.md §8.3 (mobile-app repo).
 *
 * Before these existed, a user who just wanted to move USDC from Base to
 * Arbitrum had NO PATH AT ALL: `defi_cross_chain_deposit` is welded to a
 * DeFi deposit (§4.5). These four tools are the standalone surface.
 *
 * ## Identifiers are CAIP-2 / CAIP-19
 *
 * `from_chain_id: integer` could not carry a Solana cluster or a Sui
 * network, and an `0x…{40}` asset field could not carry an SPL mint or a
 * Sui coin type (§4.1, §4.4). Every chain field here is a CAIP-2 string
 * and every asset field a CAIP-19 string, which removes that whole class
 * of blocker generically instead of adding per-namespace special cases.
 *
 * ## What the model does NOT control
 *
 * Slippage is a fixed server-side default per route class (§8.4) and is
 * deliberately absent from these schemas. A safety-critical number must
 * not be under LLM control. Likewise the model never supplies a bridge
 * contract, a route, or a provider — it names chains, assets, and an
 * amount, and the backend resolves the rest.
 */

import { composeAgentTools } from '../../../tools/internal/compose'
import type { JsonSchemaProperty, ToolMeta } from '../../../tools/internal/types'

const CAIP2_PROP = (description: string): JsonSchemaProperty => ({
  type: 'string',
  pattern: '^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$',
  description,
})

const CAIP19_PROP = (description: string): JsonSchemaProperty => ({
  type: 'string',
  pattern: '^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}/[-a-z0-9]{3,8}(:.{1,128})?$',
  description,
})

const CAIP_GUIDANCE =
  'CAIP-2 chain id, e.g. "eip155:8453" (Base), "eip155:42161" (Arbitrum), ' +
  '"solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "sui:mainnet", "stellar:pubnet". ' +
  'Call bridge_get_support first if unsure which chains are reachable.'

const ASSET_GUIDANCE =
  'CAIP-19 asset id, e.g. "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" ' +
  'for USDC on Base, or "eip155:1/slip44:60" for native ETH. The asset id ' +
  'must sit on the matching chain.'

const BRIDGE_GET_SUPPORT: ToolMeta = {
  name: 'bridge_get_support',
  category: 'utility',
  executor: 'mobile',
  capability: 'read',
  description:
    'List which chains can currently be bridged between, and which providers serve them. ' +
    'Query this before quoting when you are unsure a pair is reachable. The matrix is ' +
    'fetched live, so newly supported chains appear without an app update. If it comes ' +
    'back degraded, say routes could not be checked right now, never that a chain is unsupported.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
}

const BRIDGE_QUOTE: ToolMeta = {
  name: 'bridge_quote',
  category: 'utility',
  executor: 'mobile',
  capability: 'read',
  description:
    'Quote moving an asset from one chain to another. Returns the expected and MINIMUM ' +
    'received amounts, an itemised fee breakdown, the bridge being used, the destination ' +
    'address, and any destination preconditions the user must clear first. Always quote ' +
    'before bridge_execute so the user sees the numbers. The result renders as a card: do ' +
    'not restate its figures in prose. If it returns routable:false, that is a capability ' +
    'boundary, not a failure, so explain plainly that the pair cannot be routed.',
  inputSchema: {
    type: 'object',
    properties: {
      from_chain: CAIP2_PROP(`Source chain. ${CAIP_GUIDANCE}`),
      to_chain: CAIP2_PROP(`Destination chain. ${CAIP_GUIDANCE}`),
      from_asset: CAIP19_PROP(`Asset being sent. ${ASSET_GUIDANCE}`),
      to_asset: CAIP19_PROP(`Asset to receive. ${ASSET_GUIDANCE}`),
      amount_raw: {
        type: 'string',
        pattern: '^[0-9]+$',
        description:
          "Amount in the SOURCE token's smallest unit, as a decimal string " +
          '(bigint-safe). Use the token decimals from the balance/asset tools, ' +
          'never a guessed value.',
      },
      to_address: {
        type: 'string',
        description:
          'Optional destination address. Omit for a same-namespace bridge and the ' +
          "executor uses the user's own address on that chain. REQUIRED when the " +
          'destination is a different namespace (for example Base to Solana), ' +
          'because that is a different address derived from the same wallet.',
      },
    },
    required: ['from_chain', 'to_chain', 'from_asset', 'to_asset', 'amount_raw'],
    additionalProperties: false,
  },
}

const BRIDGE_EXECUTE: ToolMeta = {
  name: 'bridge_execute',
  category: 'utility',
  executor: 'mobile',
  capability: 'write',
  description:
    'Execute a bridge the user has approved. Takes the same route parameters as ' +
    'bridge_quote and re-prices it at signing time, so a quote the user read minutes ' +
    'ago is never submitted stale. Pass min_receive_raw from the quote the user actually ' +
    'saw so the transfer is refused if the guaranteed amount has dropped below it. ' +
    'A bridge is not finished when this returns: poll bridge_status.',
  inputSchema: {
    type: 'object',
    properties: {
      from_chain: CAIP2_PROP(`Source chain. ${CAIP_GUIDANCE}`),
      to_chain: CAIP2_PROP(`Destination chain. ${CAIP_GUIDANCE}`),
      from_asset: CAIP19_PROP(`Asset being sent. ${ASSET_GUIDANCE}`),
      to_asset: CAIP19_PROP(`Asset to receive. ${ASSET_GUIDANCE}`),
      amount_raw: {
        type: 'string',
        pattern: '^[0-9]+$',
        description:
          "Amount in the SOURCE token's smallest unit, as a decimal string. " +
          'Must match the amount the user approved.',
      },
      to_address: {
        type: 'string',
        description:
          'Optional destination address. Required for a cross-namespace bridge. ' +
          'Must match the address shown on the quote the user approved.',
      },
      min_receive_raw: {
        type: 'string',
        pattern: '^[0-9]+$',
        description:
          'The guaranteed minimum received amount from the quote the user approved ' +
          "(the quote's to_amount_min_raw), in the DESTINATION token's smallest unit. " +
          'The executor refuses to sign if a fresh quote cannot match it.',
      },
      gas_top_up_usd: {
        type: 'integer',
        minimum: 1,
        description:
          'Optional. Buy this many US dollars of the destination gas token as ' +
          'part of the same request, so the user can actually move the funds ' +
          'after they arrive. Set this ONLY when the user explicitly agreed to ' +
          'it, usually after a quote reported a no_destination_gas blocker. It ' +
          'is a separate second transaction and is reported separately.',
      },
    },
    required: ['from_chain', 'to_chain', 'from_asset', 'to_asset', 'amount_raw'],
    additionalProperties: false,
  },
}

const BRIDGE_STATUS: ToolMeta = {
  name: 'bridge_status',
  category: 'utility',
  executor: 'mobile',
  capability: 'read',
  description:
    'Check where a submitted bridge has got to. Terminal outcome is one of completed, ' +
    'partial, refunded, or failed. IMPORTANT: partial means the full value arrived but ' +
    'in a DIFFERENT token, and refunded means the funds went back to the source chain. ' +
    'Neither is a success and neither is an error: name the token actually received, or ' +
    'the chain the refund landed on. Waiting for confirmation can take 15 to 20 minutes ' +
    'on a standard transfer, which is normal and not a fault.',
  inputSchema: {
    type: 'object',
    properties: {
      from_chain: CAIP2_PROP(`Source chain of the original transfer. ${CAIP_GUIDANCE}`),
      to_chain: CAIP2_PROP(`Destination chain of the original transfer. ${CAIP_GUIDANCE}`),
      source_tx_hash: {
        type: 'string',
        description:
          'The source-chain transaction hash, signature, or digest returned by bridge_execute.',
      },
      provider: {
        type: 'string',
        description:
          'Optional provider key from the quote (for example "lifi" or "cctp").',
      },
    },
    required: ['from_chain', 'to_chain', 'source_tx_hash'],
    additionalProperties: false,
  },
}

export const BRIDGE_TOOLS: Record<string, ToolMeta> = composeAgentTools('defi', {
  bridge_get_support: BRIDGE_GET_SUPPORT,
  bridge_quote: BRIDGE_QUOTE,
  bridge_execute: BRIDGE_EXECUTE,
  bridge_status: BRIDGE_STATUS,
})
