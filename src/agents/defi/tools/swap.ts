/**
 * `swap_*` — standalone same-chain token swap capability.
 *
 * Spec: docs/swap-capability-spec.md §7.
 *
 * Three tools:
 *   - `swap_quote`: quote same-chain swap across supported DEXes
 *   - `swap_execute`: biometric-gated execution of approved quote
 *   - `swap_status`: tracking swap transaction outcome
 *
 * Venue selection is the app's (the route registry), never the model's,
 * so these descriptions name no provider and no chain routing. Sui swaps
 * stay on `defi_intent_*` (swap spec §4.5).
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
  'CAIP-2 chain id: "eip155:<chainId>" for EVM, "solana:<genesis prefix>", "sui:mainnet". ' +
  "Take it from the user's wallet or get_supported_chains; never assume a chain is supported."

const ASSET_GUIDANCE =
  "CAIP-19 asset id from swap_find_token or the user's balances, never typed from memory. " +
  'The asset id must sit on the matching chain.'

const SYMBOL_HINT: JsonSchemaProperty = {
  type: 'string',
  description:
    'The symbol the user asked for (e.g. "USDC"). Advisory only: the device checks it ' +
    'against the resolved token and stops on a mismatch.',
}

const SWAP_FIND_TOKEN: ToolMeta = {
  name: 'swap_find_token',
  category: 'utility',
  executor: 'mobile',
  capability: 'read',
  description:
    'Look up a token by symbol, name or address on one chain and get its CAIP-19 id and ' +
    'decimals, from the app catalogue and the swap providers\' own token lists. Use it BEFORE ' +
    'swap_quote whenever the user names a token you do not already have a CAIP-19 id for from ' +
    'their balances; never guess a contract address. `verified: false` is fine to quote, but ' +
    'the card then asks the user to check the contract address and confirm it before ' +
    'swap_execute will run; never describe such a token as official. An empty result means no provider offers that token on that ' +
    'chain: say so plainly.',
  inputSchema: {
    type: 'object',
    properties: {
      chain: CAIP2_PROP(`Chain to search. ${CAIP_GUIDANCE}`),
      query: {
        type: 'string',
        description: 'The symbol or name the user said, e.g. "EURC" or "euro coin".',
      },
    },
    required: ['chain', 'query'],
    additionalProperties: false,
  },
}

const SWAP_QUOTE: ToolMeta = {
  name: 'swap_quote',
  category: 'utility',
  executor: 'mobile',
  capability: 'read',
  description:
    'Quote swapping one token for another on the SAME chain (EVM chains and Solana; for Sui ' +
    'use defi_intent_preview). Returns expected and minimum received amounts, price impact, ' +
    'venue attribution, and route comparison. Always quote before swap_execute so the user ' +
    'sees the terms. The app picks the venue.',
  inputSchema: {
    type: 'object',
    properties: {
      chain: CAIP2_PROP(`Chain for the swap. ${CAIP_GUIDANCE}`),
      from_asset: CAIP19_PROP(`Asset being sold. ${ASSET_GUIDANCE}`),
      to_asset: CAIP19_PROP(`Asset being bought. ${ASSET_GUIDANCE}`),
      amount_raw: {
        type: 'string',
        pattern: '^[0-9]+$',
        description:
          "Amount in the SOURCE token's smallest unit, as a decimal string " +
          '(bigint-safe). Use the token decimals from the balance/asset tools.',
      },
      from_asset_symbol_hint: SYMBOL_HINT,
      to_asset_symbol_hint: SYMBOL_HINT,
    },
    required: ['chain', 'from_asset', 'to_asset', 'amount_raw'],
    additionalProperties: false,
  },
}

const SWAP_EXECUTE: ToolMeta = {
  name: 'swap_execute',
  category: 'utility',
  executor: 'mobile',
  capability: 'write',
  description:
    'Execute a same-chain swap the user has approved. Re-prices at signing time so stale quotes ' +
    "are never executed. The user's biometric authorization is requested before signing. " +
    'Fails with price_impact_too_high, asset_symbol_mismatch or unverified_token_unconfirmed ' +
    'until the user acknowledges that warning on the quote card.',
  inputSchema: {
    type: 'object',
    properties: {
      chain: CAIP2_PROP(`Chain for the swap. ${CAIP_GUIDANCE}`),
      from_asset: CAIP19_PROP(`Asset being sold. ${ASSET_GUIDANCE}`),
      to_asset: CAIP19_PROP(`Asset being bought. ${ASSET_GUIDANCE}`),
      amount_raw: {
        type: 'string',
        pattern: '^[0-9]+$',
        description:
          "Amount in the SOURCE token's smallest unit, as a decimal string.",
      },
      min_receive_raw: {
        type: 'string',
        pattern: '^[0-9]+$',
        description:
          'The guaranteed minimum received amount from the quote the user approved ' +
          '(toAmountMinRaw). The executor refuses to sign if a fresh quote cannot match it.',
      },
      from_asset_symbol_hint: SYMBOL_HINT,
      to_asset_symbol_hint: SYMBOL_HINT,
    },
    required: ['chain', 'from_asset', 'to_asset', 'amount_raw', 'min_receive_raw'],
    additionalProperties: false,
  },
}

const SWAP_STATUS: ToolMeta = {
  name: 'swap_status',
  category: 'utility',
  executor: 'mobile',
  capability: 'read',
  description:
    'Check the status of a submitted swap transaction.',
  inputSchema: {
    type: 'object',
    properties: {
      chain: CAIP2_PROP(`Chain of the swap. ${CAIP_GUIDANCE}`),
      tx_hash: {
        type: 'string',
        description: 'The transaction hash returned by swap_execute.',
      },
      provider: {
        type: 'string',
        description: 'Optional provider key from the quote ("tower" or "lifi").',
      },
    },
    required: ['chain', 'tx_hash'],
    additionalProperties: false,
  },
}

export const SWAP_TOOLS: Record<string, ToolMeta> = composeAgentTools('defi', {
  swap_find_token: SWAP_FIND_TOKEN,
  swap_quote: SWAP_QUOTE,
  swap_execute: SWAP_EXECUTE,
  swap_status: SWAP_STATUS,
})
