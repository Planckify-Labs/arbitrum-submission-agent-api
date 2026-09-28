/**
 * Wallet agent — owns every tool that requires the device to sign or
 * authenticate against the user's session.
 *
 * Spec reference: docs/multi-agent-architecture-spec.md §5.
 *
 * `tool_prefixes` matches the existing flat tool registry in
 * `src/tools/registry.ts` — keep in lockstep with §5 and the shared
 * `agents/manifests/agentManifests.json` (Task 02).
 *
 * Handler + prompts land in Task 11.
 */

import type { AgentCard } from '../types'

export const walletCard: AgentCard = {
  id: 'wallet',
  version: '0.1.0',
  display_name: 'Wallet specialist',
  description:
    'Owns balances, transfers, approvals, address book, gas estimation, and points. Use for anything the device must sign or authenticate.',
  routing: [
    {
      handles: 'balances and token holdings ("what do I have", "how much USDC"), wallet address, supported chains',
      tools: [
        'get_native_balance',
        'get_wallet_assets',
        'get_balance',
        'get_sui_balance',
        'get_sol_balance',
        'get_xlm_balance',
        'get_wallet_address',
        'get_supported_chains',
      ],
    },
    { handles: 'NFTs / collectibles', tools: ['get_wallet_nfts'] },
    {
      handles: 'sending money or tokens to an address or a saved contact ("send $50 to mom"), the address book',
      tools: ['send_native', 'send_token', 'search_address_book', 'get_address_book', 'get_address_book_entry'],
    },
    { handles: 'looking up a past transaction', tools: ['get_transaction'] },
    {
      handles: 'token approvals, contract reads/calls, gas estimates',
      tools: ['approve_erc20', 'read_contract', 'write_contract', 'estimate_gas'],
    },
    {
      handles: 'points: balance, history, conversion rate, adding points from a stablecoin, signing in to points',
      tools: [
        'get_points_balance',
        'get_points_history',
        'get_points_price',
        'deposit_points',
        'deposit_points_sol',
        'request_authentication',
      ],
    },
    {
      handles:
        'redeeming points for products: game top-ups (e.g. Mobile Legends diamonds), phone credit (pulsa), data packages, vouchers; redemption status and history',
      tools: [
        'get_redemption_categories',
        'get_redemption_catalog',
        'search_redemption_catalog',
        'get_product_details',
        'get_product_input_fields',
        'execute_redemption',
        'execute_booking_sol',
        'get_redemption_status',
        'get_redemption_history',
      ],
    },
    { handles: 'Stellar trustlines (letting the wallet hold a new asset)', tools: ['establish_stellar_trustline'] },
  ],
  // Spec §5 lists nine "canonical" prefixes but two of them
  // (`points_`, `address_book_`) match no actual tool name in the
  // registry today — every points / address-book tool starts with
  // `get_` or `search_` (e.g. `get_points_balance`,
  // `search_address_book`). Dropping the dead prefixes keeps
  // `assertRegistryInvariants` happy at boot; the `search_/deposit_/
  // execute_/request_` families round out the rest of the existing
  // tool name surface (Wallet owns all 40 mobile executors per §5
  // footnote).
  tool_prefixes: [
    'get_',
    'send_',
    'transfer_',
    'approve_',
    'read_contract',
    'estimate_gas',
    'write_contract',
    'search_',
    'deposit_',
    'execute_',
    'request_',
    // `cancel_` (cancel_booking) and `create_` (create_purchase) are
    // mobile-only TakumiPay executors not yet wired into the server
    // TOOL_REGISTRY. Add them here so mobile boot doesn't crash.
    'cancel_',
    'create_',
    // `establish_` (establish_stellar_trustline) — Stellar-only opt-in
    // (changeTrust). No cross-chain analogue; new verb family owned by
    // Wallet alongside the other Stellar send tools.
    'establish_',
    // `x402_` (x402_fetch) — agent-initiated x402 micropayments (Phase 5).
    'x402_',
  ],
  capabilities: [
    'read_balance',
    'sign_tx',
    'approve_token',
    'gas_estimate',
    'points_read',
    'points_write',
    'address_book',
  ],
  requires_wallet_context: true,
  requires_jwt: true,
  default_system_prompt_ref: 'wallet.v1',
  status: 'ready',
}
