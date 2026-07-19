/**
 * Chain-agnostic (capability-based) wallet tools.
 *
 * These are a **Facade** over the per-namespace balance/token tools: the
 * model calls ONE tool that expresses INTENT ("read my native balance",
 * "list my assets") and the mobile executor dispatches to the correct
 * namespace implementation via the `WalletKitAdapter` registry. The model
 * never has to know whether the wallet is EVM / Solana / Sui / Stellar, and
 * never has to pick between `get_wallet_balance` / `get_wallet_sol_balance`
 * / `get_wallet_xlm_balance` / … — that whole per-namespace surface is
 * hidden from the LLM (see `namespaceScope.ts` `SUPERSEDED_BY_CAPABILITY`).
 *
 * The superseded tools stay REGISTERED (executors, result-shapes, history
 * replay, registry parity all unchanged) — the capability tools simply
 * delegate to them on the device. Only the model-facing surface collapses.
 */

import { composeAgentTools } from '../../../tools/internal/compose';
import type { ToolMeta } from '../../../tools/internal/types';

export const WALLET_CAPABILITY_TOOLS: Record<string, ToolMeta> = composeAgentTools(
  'wallet',
  {
    get_native_balance: {
      name: 'get_native_balance',
      category: 'blockchain_read',
      executor: 'mobile',
      capability: 'read',
      description:
        "Read the connected wallet's NATIVE coin balance on its currently " +
        'active chain. The device automatically returns the right coin for ' +
        "the wallet's namespace — ETH on EVM, SOL on Solana, SUI on Sui, XLM " +
        'on Stellar — so you do NOT choose a per-chain tool and do NOT pass a ' +
        'namespace or chain id. Takes NO input. This is THE single tool for ' +
        '"what is my balance / how much do I have" questions about the native ' +
        'coin. The result renders as a balances card the user already sees, so ' +
        'summarize in one short sentence rather than re-listing the number.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    get_wallet_assets: {
      name: 'get_wallet_assets',
      category: 'blockchain_read',
      executor: 'mobile',
      capability: 'read',
      description:
        "List the connected wallet's supported tokens/assets on its active " +
        'chain, with optional live balances — the chain-agnostic asset list ' +
        '(ERC-20 on EVM, SPL on Solana, Coin<T> on Sui, trustline assets on ' +
        'Stellar). The device picks the right source for the active namespace, ' +
        'so you do NOT pass a namespace or chain id. Each row carries symbol, ' +
        'name, decimals, is_native / is_stable_coin flags, optional ' +
        'pegged_currency, and (when `include_balance: true`) the live on-chain ' +
        'balance. Use this to answer "what tokens/assets do I hold", to find ' +
        'whether the wallet holds a given symbol (pass `symbol`), and for ' +
        'stablecoin overviews (`is_stable_coin: true`). The native coin is ' +
        'included as a row unless `is_native_currency: false`. If the result ' +
        'is empty for a queried symbol, say the asset is not in the supported ' +
        'list — do NOT report a balance of zero. Renders as a balances card.',
      inputSchema: {
        type: 'object',
        properties: {
          include_balance: {
            type: 'boolean',
            description:
              'If true, resolve live on-chain balances. Balance fields are ' +
              'omitted for assets the wallet holds none of / has no trustline for.',
          },
          symbol: {
            type: 'string',
            description:
              'Optional filter: only return assets whose symbol matches ' +
              '(case-insensitive prefix or exact match).',
          },
          is_stable_coin: {
            type: 'boolean',
            description:
              'If true, return only stablecoin assets. If false, only ' +
              'non-stablecoins. Omit to return all.',
          },
          is_native_currency: {
            type: 'boolean',
            description:
              'If true (default), include the native coin as the first row. ' +
              'If false, exclude it and return issued/non-native assets only.',
          },
        },
        required: [],
        additionalProperties: false,
      },
    },

    send_native: {
      name: 'send_native',
      category: 'blockchain_write',
      executor: 'mobile',
      capability: 'write',
      description:
        "Send the connected wallet's NATIVE coin to another address on the " +
        'active chain — chain-agnostic (ETH on EVM, SOL on Solana, SUI on Sui, ' +
        'XLM on Stellar). You do NOT choose a per-chain send tool and do NOT ' +
        'pass a namespace or chain id. Provide `amount` as a human-readable ' +
        'decimal string (e.g. "1.5"); the device converts to base units ' +
        'internally — never compute raw units yourself. The user confirms on ' +
        'the mobile approval sheet before broadcast. Do NOT call estimate_gas ' +
        'first — the app estimates and shows the fee on the sheet.',
      inputSchema: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description:
              'Recipient address on the active chain (its native address ' +
              'format — 0x-hex on EVM, base58 on Solana, 0x on Sui, G-strkey ' +
              'on Stellar). Get it from the user or the address book.',
          },
          amount: {
            type: 'string',
            pattern: '^[0-9]+(\\.[0-9]+)?$',
            description:
              'Amount of the native coin to send, as a decimal string. Must be greater than zero.',
          },
        },
        required: ['to', 'amount'],
        additionalProperties: false,
      },
    },

    send_token: {
      name: 'send_token',
      category: 'blockchain_write',
      executor: 'mobile',
      capability: 'write',
      description:
        'Send a NON-native token/asset from the connected wallet to another ' +
        'address on the active chain — chain-agnostic (ERC-20 on EVM, SPL on ' +
        'Solana, Coin<T> on Sui, issued/trustline asset on Stellar). You do ' +
        'NOT choose a per-chain send tool, do NOT pass a namespace, and do NOT ' +
        'deal with contract addresses / mints / coin types / issuers — pass ' +
        'the token `symbol` (from get_wallet_assets, e.g. "USDC") and the ' +
        'device resolves the on-chain identifier + decimals itself. Provide ' +
        '`amount` as a human-readable decimal string (e.g. "10.5"). The user ' +
        'confirms on the mobile approval sheet before broadcast. For the ' +
        'native coin use send_native instead. On Stellar the transfer FAILS ' +
        'if the recipient has no trustline for the asset.',
      inputSchema: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description:
              "Recipient address on the active chain (the chain's native " +
              'address format). Get it from the user or the address book.',
          },
          symbol: {
            type: 'string',
            description:
              'Token symbol to send (e.g. "USDC"), as shown by ' +
              'get_wallet_assets. The device resolves it to the on-chain ' +
              'identifier for the active namespace.',
          },
          amount: {
            type: 'string',
            pattern: '^[0-9]+(\\.[0-9]+)?$',
            description:
              'Human-readable amount to send, e.g. "10.5". The device converts to base units internally.',
          },
        },
        required: ['to', 'symbol', 'amount'],
        additionalProperties: false,
      },
    },
  },
);
