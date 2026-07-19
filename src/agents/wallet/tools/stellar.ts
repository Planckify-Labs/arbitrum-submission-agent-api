import { composeAgentTools } from '../../../tools/internal/compose';
import { STELLAR_ADDRESS_PROP } from '../../../tools/internal/schemas';
import type { ToolMeta } from '../../../tools/internal/types';

export const WALLET_STELLAR_TOOLS: Record<string, ToolMeta> = composeAgentTools('wallet', {
  // ─── Mobile / blockchain_read — Stellar native ────────────────────────────
  // Stellar-namespaced siblings of `get_wallet_balance` / `get_balance` /
  // `send_native_token`. Picked when `wallet_context.namespace === "stellar"`.
  // Like Solana/Sui there is no `chain_id` — the Stellar network
  // (mainnet / testnet) is carried on the session via `wallet_context` and
  // resolved by the mobile executor from the persisted active chain. Stellar
  // transaction identifiers are Horizon hex hashes returned in `data.hash`,
  // not the wire-typed `tx_hash` slot (mirrors Sui `data.digest`).
  get_wallet_xlm_balance: {
    name: 'get_wallet_xlm_balance',
    category: 'blockchain_read',
    executor: 'mobile',
    capability: 'read',
    description:
      "Read the connected mobile wallet's native XLM (Stellar Lumens) " +
      'balance on the active Stellar network. Use this when ' +
      'wallet_context.namespace is "stellar" — do NOT use get_wallet_balance ' +
      '(EVM-only), get_wallet_sol_balance (Solana-only), or ' +
      'get_wallet_sui_balance (Sui-only).',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  get_xlm_balance: {
    name: 'get_xlm_balance',
    category: 'blockchain_read',
    executor: 'mobile',
    capability: 'read',
    description:
      'Read the native XLM balance of an arbitrary Stellar address on the ' +
      'active network. Use this when wallet_context.namespace is "stellar". ' +
      'For EVM addresses use get_balance, for Solana use get_sol_balance, ' +
      'for Sui use get_sui_balance.',
    inputSchema: {
      type: 'object',
      properties: {
        address: STELLAR_ADDRESS_PROP(
          'Stellar account address (ed25519 strkey — starts with G, 56 chars). Defaults to the connected wallet address when omitted.',
        ),
      },
      required: [],
      additionalProperties: false,
    },
  },

  get_wallet_stellar_assets: {
    name: 'get_wallet_stellar_assets',
    category: 'blockchain_read',
    executor: 'mobile',
    capability: 'read',
    description:
      'Return the supported Stellar asset list for the active Stellar ' +
      'network, sourced from the backend token registry — the Stellar ' +
      'counterpart to get_wallet_tokens (EVM-only), get_wallet_spl_tokens ' +
      '(Solana-only) and get_wallet_sui_coins (Sui-only). Each non-native ' +
      "row carries symbol, name, address (Stellar's compound `CODE:ISSUER` " +
      'identifier — the asset code plus the G… issuer account), decimals ' +
      '(always 7 on Stellar), is_native / is_stable_coin flags, optional ' +
      'pegged_currency, and (when `include_balance: true`) the live on-chain ' +
      'trustline balance. Use this when wallet_context.namespace is "stellar" ' +
      'to resolve a token symbol (e.g. "USDC") to its `code` and `issuer` ' +
      'before calling send_stellar_asset or establish_stellar_trustline — ' +
      'split the row\'s `address` on ":" to get them. Native XLM is included ' +
      'as a pseudo-row with is_native: true unless excluded. DO NOT report ' +
      'balance as zero when the result set is empty for a queried symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        include_balance: {
          type: 'boolean',
          description:
            'If true, resolve live on-chain trustline balances via a single ' +
            'Horizon `loadAccount` call. Balance fields (`balance_raw`, ' +
            '`balance_display`) are omitted for assets the wallet holds no ' +
            'trustline for, or when the account is not yet funded.',
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
            'If true, return only stablecoin Stellar assets. If false, ' +
            'return only non-stablecoin assets. Omit to return all.',
        },
        is_native_currency: {
          type: 'boolean',
          description:
            'If true (default), include native XLM as the first row. ' +
            'If false, exclude it and return issued-asset-only rows.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },

  // ─── Mobile / blockchain_write — Stellar native ───────────────────────────
  send_xlm: {
    name: 'send_xlm',
    category: 'blockchain_write',
    executor: 'mobile',
    capability: 'write',
    description:
      'Send native XLM from the connected mobile wallet to another Stellar ' +
      'address. Use this when wallet_context.namespace is "stellar"; for EVM ' +
      'native transfers use send_native_token, for Solana use send_sol, for ' +
      'Sui use send_sui. Provide `amount_xlm` as a human-readable decimal ' +
      'string (e.g. "1.5"); the mobile converts to stroops (1 XLM = 1e7 ' +
      'stroops) internally. The mobile auto-selects createAccount vs payment ' +
      'when the destination is unfunded — no flag needed. The user confirms ' +
      'the transfer on the mobile approval sheet before it is broadcast. ' +
      'Note: the resulting transaction hash is returned in `data.hash`, not ' +
      'in `tx_hash`.',
    inputSchema: {
      type: 'object',
      properties: {
        to: STELLAR_ADDRESS_PROP(
          'Recipient Stellar address (ed25519 strkey — starts with G, 56 chars).',
        ),
        amount_xlm: {
          type: 'string',
          pattern: '^[0-9]+(\\.[0-9]+)?$',
          description:
            'Amount of XLM to send, as a decimal string. Must be greater than zero.',
        },
      },
      required: ['to', 'amount_xlm'],
      additionalProperties: false,
    },
  },

  send_stellar_asset: {
    name: 'send_stellar_asset',
    category: 'blockchain_write',
    executor: 'mobile',
    capability: 'write',
    description:
      'Transfer a non-native Stellar asset (a `CODE:ISSUER` credit alt-num, ' +
      'e.g. USDC) from the connected mobile wallet to a recipient. Use this ' +
      'when wallet_context.namespace is "stellar" and the user wants to send ' +
      'an issued asset — for native XLM use send_xlm instead. ALWAYS obtain ' +
      '`code` and `issuer` from get_wallet_stellar_assets (split its `address` ' +
      'field on ":") — never guess them. Provide `amount` as a human-readable ' +
      'decimal string (e.g. "10.5"); Stellar assets are 7-decimal fixed point ' +
      'and the mobile converts internally — do NOT compute raw amounts ' +
      'yourself. The transfer FAILS if the recipient has not established a ' +
      'trustline for the asset. Note: the resulting transaction hash is ' +
      'returned in `data.hash`, not in `tx_hash`.',
    inputSchema: {
      type: 'object',
      properties: {
        to: STELLAR_ADDRESS_PROP(
          'Recipient Stellar address (ed25519 strkey — starts with G, 56 chars).',
        ),
        code: {
          type: 'string',
          description:
            'Stellar asset code (1-12 alphanumeric chars, e.g. "USDC") from ' +
            'get_wallet_stellar_assets.',
        },
        issuer: STELLAR_ADDRESS_PROP(
          'Issuer account address (G… strkey) for the asset, from get_wallet_stellar_assets.',
        ),
        amount: {
          type: 'string',
          pattern: '^[0-9]+(\\.[0-9]+)?$',
          description:
            'Human-readable transfer amount, e.g. "10.5". The mobile converts ' +
            'to the 7-decimal raw amount internally.',
        },
      },
      required: ['to', 'code', 'issuer', 'amount'],
      additionalProperties: false,
    },
  },

  establish_stellar_trustline: {
    name: 'establish_stellar_trustline',
    category: 'blockchain_write',
    executor: 'mobile',
    capability: 'write',
    description:
      'Opt the CONNECTED wallet into holding a given Stellar asset by ' +
      'establishing a trustline (a `changeTrust` operation). Use this when ' +
      'wallet_context.namespace is "stellar" and the user wants to receive or ' +
      'hold an issued asset they do not yet trust — Stellar requires a ' +
      'trustline before an account can hold any non-native asset. This has no ' +
      'cross-chain analogue (EVM/Solana/Sui have no opt-in step). Obtain ' +
      '`code` and `issuer` from get_wallet_stellar_assets. If the wallet ' +
      'already trusts the asset the tool is a no-op and reports ' +
      'already_trusted: true. The user confirms on the mobile approval sheet.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'Stellar asset code (1-12 alphanumeric chars, e.g. "USDC") to trust.',
        },
        issuer: STELLAR_ADDRESS_PROP(
          'Issuer account address (G… strkey) of the asset to trust.',
        ),
      },
      required: ['code', 'issuer'],
      additionalProperties: false,
    },
  },
});
