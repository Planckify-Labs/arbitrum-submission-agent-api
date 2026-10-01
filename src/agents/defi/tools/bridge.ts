/**
 * `bridge_*` — the general-purpose bridge capability.
 *
 * Spec: docs/bridge-capability-spec.md §8.3 (mobile-app repo).
 *
 * Before these existed, a user who just wanted to move USDC from Base to
 * Arbitrum had NO PATH AT ALL: `defi_cross_chain_deposit` is welded to a
 * DeFi deposit (§4.5). These tools are the standalone surface, plus
 * `bridge_claim` for the one route whose destination leg the user's own
 * wallet has to sign (USDC into Stellar, which has no Circle Forwarding
 * Service).
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
    'boundary, not a failure, so explain plainly that the pair cannot be routed. ' +
    'Cross-chain ONLY: a swap within one chain is swap_quote (defi_intent_preview on Sui).',
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
          'Optional. OMIT IT unless the user actually named an address. The ' +
          "device resolves the user's own wallet on the destination chain — " +
          'including cross-namespace, where Base to Solana lands on a ' +
          'different address derived from the same seed — and the quote card ' +
          'shows which wallet it picked, with a control to change it. NEVER ' +
          'ask the user to type or paste their own address: the card is where ' +
          'they confirm it. This resolution only works for a chain the user ' +
          'actually holds a wallet on (see "Wallets available on" in the ' +
          'Connected Wallet context) — a private-key user has just one ' +
          'namespace. Do not work around a missing destination wallet by ' +
          'asking for an address; there is nothing for them to paste.',
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
    'The mobile app progress card tracks transfer status in real time; do NOT poll ' +
    'bridge_status in an agent loop. Fails with asset_symbol_mismatch or ' +
    'unverified_token_unconfirmed until the user acknowledges that warning on the quote ' +
    'card. Cross-chain ONLY: a same-chain swap is swap_execute.',
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
          'Optional. Pass the destination address FROM THE QUOTE the user just ' +
          'saw (its `to.address`) so this executes against what was on screen. ' +
          'Omit it if you do not have one; the device resolves the same wallet ' +
          'it showed. Never ask the user to supply it.',
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
    'on a standard transfer, which is normal and not a fault. If the result says ' +
    'claim_required is true, the funds are ' +
    'waiting for the user to receive them on the destination: offer bridge_claim.',
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

const BRIDGE_CLAIM: ToolMeta = {
  name: 'bridge_claim',
  category: 'utility',
  executor: 'mobile',
  capability: 'write',
  description:
    'Receive the funds of a bridge that is waiting on the destination wallet. Call it ' +
    'ONLY when bridge_status returned claim_required: true for that transfer (today: ' +
    'USDC arriving on Stellar, which Circle does not deliver automatically). The ' +
    "user's own destination wallet signs one small network transaction that mints the " +
    'funds to the recipient the original transfer already named; it cannot redirect ' +
    'them. Pass the same from_chain, to_chain, source_tx_hash and provider you gave ' +
    'bridge_status. Never call it speculatively.',
  inputSchema: {
    type: 'object',
    properties: {
      from_chain: CAIP2_PROP(`Source chain of the original transfer. ${CAIP_GUIDANCE}`),
      to_chain: CAIP2_PROP(`Destination chain of the original transfer. ${CAIP_GUIDANCE}`),
      source_tx_hash: {
        type: 'string',
        description: 'The source-chain transaction hash returned by bridge_execute.',
      },
      provider: {
        type: 'string',
        description: 'Optional provider key from the quote (for example "cctp").',
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
  bridge_claim: BRIDGE_CLAIM,
})
