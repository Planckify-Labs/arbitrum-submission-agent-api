/**
 * Authoritative set of tool names whose results render as a full,
 * self-contained UI card in the mobile chat.
 *
 * This is the agent-api mirror of the mobile
 * `components/home/TakumiAgent/StructuredUI/registry.ts` `toolComponents`
 * map — the ground truth for "which tool outputs the user already SEES as
 * a card". `composeAgentTools` stamps `rendersCard: true` on any tool
 * whose name appears here, and the engine injects the per-agent subset
 * into the system prompt so the model never re-lists / re-tabulates data
 * the card already shows (the DeFi-opportunity duplicate-table bug).
 *
 * KEEP IN SYNC with the mobile `toolComponents` keys. Names here that no
 * agent owns (e.g. `swap_quote`, `approve_spending`) are harmless — they
 * only stamp a tool that actually exists, and only the agent's own tools
 * are ever named in its prompt.
 */
export const CARD_BACKED_TOOL_NAMES: ReadonlySet<string> = new Set([
  // Transfers / writes → PendingTx / Solana / Sui receipt cards
  // Chain-agnostic capability sends (the model-facing surface).
  'send_native',
  'send_token',
  // Superseded per-namespace variants — hidden from the model but still
  // card-backed for history replay.
  'send_native_token',
  'transfer_erc20',
  'write_contract',
  'send_sol',
  'send_spl_token',
  'send_sui',
  'send_sui_coin',
  'send_xlm',
  'send_stellar_asset',
  'establish_stellar_trustline',
  // Approvals / swap quote
  'approve_spending',
  'approveSpending',
  'swap_quote',
  // Balance reads → BalancesCard
  // Chain-agnostic capability tools (the model-facing surface).
  'get_native_balance',
  'get_wallet_assets',
  // Superseded per-namespace variants — hidden from the model but still
  // card-backed for history replay.
  'get_wallet_tokens',
  'get_wallet_spl_tokens',
  'get_wallet_sui_coins',
  'get_balance',
  'get_wallet_balance',
  'get_sol_balance',
  'get_wallet_sol_balance',
  'get_sui_balance',
  'get_wallet_sui_balance',
  'get_wallet_stellar_assets',
  'get_xlm_balance',
  'get_wallet_xlm_balance',
  // Rewards catalog / product detail
  'get_redemption_catalog',
  'search_redemption_catalog',
  'get_product_details',
  // DeFi reads + flows
  'defi_list_opportunities',
  'defi_list_positions',
  'defi_get_config',
  'defi_deposit',
  'defi_withdraw',
  'defi_claim',
  'defi_rebalance',
  'defi_intent_preview',
  'defi_intent_execute',
  // Bridge (bridge-capability-spec §7). The quote card carries the full
  // disclosure surface (minimum received, itemised fees, destination
  // address, readiness blockers) and the progress card walks the
  // four-step lifecycle, so the model must not re-tabulate any of it.
  'bridge_quote',
  'bridge_execute',
  'bridge_status',
  // Paid-resource fetch
  'x402_fetch',
]);
