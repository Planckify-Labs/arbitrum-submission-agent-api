/**
 * Simulated phone for the agent eval. Production reads every value below
 * live from the device through tool calls; the eval has no device, so these
 * stand in for it. Never imported by `src/` — nothing here ships.
 *
 * A scenario is one wallet setup (chain, holdings, contacts, owned
 * namespaces). A case picks a scenario and may override any tool's answer
 * with `fixtures`. Results use the executors' `{ status, data }` shape.
 */

import type { WalletContext } from '../src/session/types'

type Result = Record<string, unknown>
type Input = Record<string, unknown>

interface Token {
  symbol: string
  name: string
  is_native: boolean
  is_stable_coin: boolean
  pegged_currency?: string
  decimals: number
  balance_display: string
}

interface Scenario {
  wallet: WalletContext
  tokens: Token[]
  contacts: Array<Record<string, unknown>>
  opportunities: Array<Record<string, unknown>>
  positions: Array<Record<string, unknown>>
}

const EVM_MOM = '0x425e000000000000000000000000000000009fc9'
const EVM_BUDI = '0x2222222222222222222222222222222222222222'
const SUI_MOM = `0x${'4'.repeat(64)}`

const ALL_NS: NonNullable<WalletContext['owned_namespaces']> = ['eip155', 'solana', 'sui', 'stellar']

export const SCENARIOS: Record<string, Scenario> = {
  /** The bug-report wallet: Monad testnet, AUSD-funded, seed phrase. */
  monad: {
    wallet: {
      address: '0x1111111111111111111111111111111111111111',
      namespace: 'eip155',
      chain_id: 10143,
      chain_name: 'Monad Testnet',
      chain_symbol: 'MON',
      label: 'Main Wallet',
      points_authenticated: true,
      owned_namespaces: ALL_NS,
    },
    tokens: [
      { symbol: 'MON', name: 'Monad', is_native: true, is_stable_coin: false, decimals: 18, balance_display: '12.5' },
      {
        symbol: 'AUSD',
        name: 'Agora USD',
        is_native: false,
        is_stable_coin: true,
        pegged_currency: 'USD',
        decimals: 6,
        balance_display: '99312.15',
      },
    ],
    contacts: [
      { id: 'c1', label: 'Mom', address: EVM_MOM, chain_name: 'Monad Testnet', is_evm: true },
      { id: 'c2', label: 'Budi', address: EVM_BUDI, chain_name: 'Monad Testnet', is_evm: true },
    ],
    opportunities: [],
    positions: [],
  },
  /** Base mainnet, seed phrase (a wallet on every namespace). */
  base: {
    wallet: {
      address: '0x3333333333333333333333333333333333333333',
      namespace: 'eip155',
      chain_id: 8453,
      chain_name: 'Base',
      chain_symbol: 'ETH',
      label: 'Main Wallet',
      points_authenticated: true,
      owned_namespaces: ALL_NS,
    },
    tokens: [
      { symbol: 'ETH', name: 'Ether', is_native: true, is_stable_coin: false, decimals: 18, balance_display: '0.42' },
      {
        symbol: 'USDC',
        name: 'USD Coin',
        is_native: false,
        is_stable_coin: true,
        pegged_currency: 'USD',
        decimals: 6,
        balance_display: '1250',
      },
      {
        symbol: 'IDRX',
        name: 'IDRX',
        is_native: false,
        is_stable_coin: true,
        pegged_currency: 'IDR',
        decimals: 2,
        balance_display: '500000',
      },
    ],
    contacts: [
      { id: 'c1', label: 'Mom', address: EVM_MOM, chain_name: 'Base', is_evm: true },
      { id: 'c2', label: 'Budi', address: EVM_BUDI, chain_name: 'Base', is_evm: true },
    ],
    opportunities: [
      {
        opportunity_id: 'op-aave-usdc',
        protocol_slug: 'aave-v3',
        pool_id: 'aave-v3-base-usdc',
        namespace: 'eip155',
        chain_id: 8453,
        asset_symbol: 'USDC',
        apy: 4.8,
        apy_7d_avg: 4.6,
        tvl_usd: 182000000,
        tier: 'conservative',
        score: 91,
      },
      {
        opportunity_id: 'op-morpho-usdc',
        protocol_slug: 'morpho-blue',
        pool_id: 'morpho-base-usdc-steak',
        namespace: 'eip155',
        chain_id: 8453,
        asset_symbol: 'USDC',
        apy: 7.9,
        apy_7d_avg: 7.1,
        tvl_usd: 41000000,
        tier: 'balanced',
        score: 84,
      },
    ],
    positions: [
      {
        position_id: 'pos-comet-1',
        protocol_slug: 'compound-v3',
        namespace: 'eip155',
        chain_id: 8453,
        asset_symbol: 'USDC',
        current_value_usd: 512.4,
        pnl_pct: 1.2,
        apy: 5.1,
      },
    ],
  },
  /** Base mainnet, private-key import: ONE namespace only. */
  base_pk: {
    wallet: {
      address: '0x5555555555555555555555555555555555555555',
      namespace: 'eip155',
      chain_id: 8453,
      chain_name: 'Base',
      chain_symbol: 'ETH',
      label: 'Imported',
      points_authenticated: true,
      owned_namespaces: ['eip155'],
    },
    tokens: [
      { symbol: 'ETH', name: 'Ether', is_native: true, is_stable_coin: false, decimals: 18, balance_display: '0.1' },
      {
        symbol: 'USDC',
        name: 'USD Coin',
        is_native: false,
        is_stable_coin: true,
        pegged_currency: 'USD',
        decimals: 6,
        balance_display: '300',
      },
    ],
    contacts: [],
    opportunities: [],
    positions: [],
  },
  /** Sui mainnet, seed phrase. */
  sui: {
    wallet: {
      address: `0x${'6'.repeat(64)}`,
      namespace: 'sui',
      chain_id: 0,
      chain_name: 'Sui',
      chain_symbol: 'SUI',
      label: 'Main Wallet',
      points_authenticated: true,
      owned_namespaces: ALL_NS,
    },
    tokens: [
      { symbol: 'SUI', name: 'Sui', is_native: true, is_stable_coin: false, decimals: 9, balance_display: '16.85' },
      {
        symbol: 'USDC',
        name: 'USD Coin',
        is_native: false,
        is_stable_coin: true,
        pegged_currency: 'USD',
        decimals: 6,
        balance_display: '40',
      },
    ],
    contacts: [{ id: 'c1', label: 'Mom', address: SUI_MOM, chain_name: 'Sui', is_evm: false }],
    opportunities: [
      {
        opportunity_id: 'op-scallop-usdc',
        protocol_slug: 'scallop',
        pool_id: '0xscallop-usdc-pool',
        namespace: 'sui',
        asset_symbol: 'USDC',
        apy: 6.1,
        apy_7d_avg: 5.8,
        tvl_usd: 96000000,
        tier: 'conservative',
        score: 88,
      },
      {
        opportunity_id: 'op-haedal-sui',
        protocol_slug: 'haedal',
        pool_id: '0xhaedal-hasui',
        namespace: 'sui',
        asset_symbol: 'SUI',
        apy: 3.4,
        apy_7d_avg: 3.3,
        tvl_usd: 210000000,
        tier: 'conservative',
        score: 90,
      },
    ],
    positions: [],
  },
}

export function scenarioWallet(name: string): WalletContext {
  const s = SCENARIOS[name]
  if (!s) throw new Error(`unknown eval scenario "${name}"`)
  return s.wallet
}

const ok = (data: unknown): Result => ({ status: 'success', data })

function filterTokens(tokens: Token[], input: Input): Token[] {
  const sym = typeof input.symbol === 'string' ? input.symbol.toLowerCase() : ''
  return tokens.filter((t) => {
    if (typeof input.is_stable_coin === 'boolean' && t.is_stable_coin !== input.is_stable_coin) return false
    if (input.is_native_currency === false && t.is_native) return false
    if (sym && !t.symbol.toLowerCase().startsWith(sym)) return false
    return true
  })
}

const PRODUCTS = [
  { product_id: 'p-mlbb', name: 'Mobile Legends Diamonds', category: 'game', input_type: 'game_id', min_points: 1500 },
  { product_id: 'p-tsel', name: 'Telkomsel Pulsa', category: 'pulsa', input_type: 'phone', min_points: 5200 },
  { product_id: 'p-gplay', name: 'Google Play Voucher', category: 'voucher', input_type: null, min_points: 10000 },
]

/** Default phone answer for `tool` in `scenario`. */
export function defaultFixture(scenario: string, tool: string, input: Input): Result {
  const s = SCENARIOS[scenario]
  const native = s.tokens.find((t) => t.is_native)
  switch (tool) {
    case 'get_native_balance':
    case 'get_balance':
    case 'get_sui_balance':
    case 'get_sol_balance':
    case 'get_xlm_balance':
      return ok({ symbol: native?.symbol, balance_display: native?.balance_display })
    case 'get_wallet_assets':
      return ok({ tokens: filterTokens(s.tokens, input), namespace: s.wallet.namespace })
    case 'get_wallet_nfts':
      return ok({
        items: [{ collection: 'Based Punks', name: 'Based Punk #88', token_id: '88', floor_price_eth: '0.03' }],
      })
    case 'get_wallet_address':
      return ok({ address: s.wallet.address })
    case 'get_supported_chains':
      return ok({
        chains: [
          { chain_id: 8453, name: 'Base' },
          { chain_id: 42161, name: 'Arbitrum One' },
          { chain_id: 10143, name: 'Monad Testnet' },
        ],
      })
    case 'search_address_book': {
      const q = typeof input.query === 'string' ? input.query.toLowerCase() : ''
      return ok({
        contacts: s.contacts.filter((c) => !q || String(c.label).toLowerCase().includes(q)),
      })
    }
    case 'get_address_book':
      return ok({ contacts: s.contacts })
    case 'get_points_balance':
      return ok({ points: 12500 })
    case 'get_points_price':
      return ok({ token_id: input.token_id, currency: input.currency, points_per_token: 100 })
    case 'get_points_history':
      return ok({ items: [{ type: 'deposit', points: 5000, created_at: '2026-09-01' }] })
    case 'get_redemption_categories':
      return ok({ categories: ['game', 'pulsa', 'data', 'voucher'] })
    case 'get_redemption_catalog':
      return ok({ categories: [{ category: 'game', products: PRODUCTS.slice(0, 1) }] })
    case 'search_redemption_catalog': {
      const q = String(input.query ?? input.category ?? '').toLowerCase()
      const hits = PRODUCTS.filter(
        (p) => !q || p.name.toLowerCase().includes(q.split(' ')[0]) || p.category === q,
      )
      return ok({ products: hits.length ? hits : PRODUCTS })
    }
    case 'get_product_details':
      return ok({
        product_id: input.product_id,
        name: 'Mobile Legends Diamonds',
        input_type: 'game_id',
        variants: [
          { product_variant_id: 'v-86', name: '86 Diamonds', prices: [{ product_price_id: 'pr-86', points: 2000 }] },
          { product_variant_id: 'v-172', name: '172 Diamonds', prices: [{ product_price_id: 'pr-172', points: 3900 }] },
        ],
      })
    case 'get_product_input_fields':
      return ok({
        fields: [
          { key: 'user_id', label: 'User ID', required: true },
          { key: 'zone_id', label: 'Zone ID', required: true },
        ],
      })
    case 'get_redemption_history':
      return ok({ items: [] })
    case 'get_redemption_status':
      return ok({ status: 'SUCCESS' })
    case 'request_authentication':
      return ok({ success: true })
    case 'defi_list_opportunities':
      return ok({ chain_scope: 'active_chain', opportunities: s.opportunities })
    case 'defi_list_positions':
      return ok({ positions: s.positions })
    case 'defi_get_config':
      return ok({ tier: 'balanced' })
    case 'defi_simulate_deposit':
      return ok({ ok: true, expected_apy: 4.8, gas_usd: 0.02 })
    case 'defi_intent_preview':
      return ok({
        intent_id: 'intent-7f3a',
        summary: `Preview of ${String(input.action ?? 'intent')}`,
        risk_flags: [],
        blocked: false,
      })
    case 'defi_list_recurring_invest':
      return ok({ plans: [] })
    case 'bridge_get_support':
      return ok({ supported: true, degraded: false })
    case 'bridge_quote':
      return ok({
        routable: true,
        quote_id: 'quote-91',
        to_amount_min_raw: '99500000',
        destination_address: 'resolved-by-device',
        blockers: [],
      })
    case 'bridge_status':
      return ok({ outcome: 'pending' })
    default:
      return ok({})
  }
}
