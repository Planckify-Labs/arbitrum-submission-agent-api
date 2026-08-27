/**
 * buildHumanSummary() — deterministic, server-side builder for the
 * `meta.human_summary` string that mobile renders in preview cards and
 * approval sheets.
 *
 * Protocol reference: AGENT_PROTOCOL.md §11 "The `human_summary` Builder
 * (Server-Side)".
 *
 * SECURITY: `input` arrives from the LLM. It MUST be Zod-validated at the
 * tool boundary before reaching this function. Even so, every case narrows
 * each field defensively and falls back to `"?"` on missing optionals so
 * the approval sheet never crashes on a malformed payload.
 *
 * Coverage: every tool in `TOOL_REGISTRY` with `capability: "write"` has an
 * explicit case. Reads do not need summaries (they execute silently), though
 * a few keep friendly labels below. The default branch returns
 * `Execute ${name}` so any unknown tool still renders something safe.
 */

import { formatEther } from 'viem'

/**
 * Truncate an EVM-style address for display.
 *
 * Format: first 6 chars + `…` + last 2 chars  (e.g. `0x742d…ef`).
 *
 * Note: the task spec description says "first 6 + `…` + last 4", but every
 * canonical expected output in the spec uses 2 trailing chars
 * (e.g. `0x742d…ef`, `0xDeFi…ef`). We match the expected output strings,
 * which are the binding acceptance criterion.
 *
 * Handles non-string / too-short input gracefully by returning a safe
 * fallback instead of throwing.
 */
export function truncateAddress(addr: unknown): string {
  if (typeof addr !== 'string' || addr.length === 0) return '?'
  // Too short to meaningfully truncate — return as-is.
  if (addr.length <= 8) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-2)}`
}

/**
 * Short-form truncation used by `write_contract` — first 6 chars + `…`,
 * no trailing characters (e.g. `0xAbCd…`).
 */
function truncateAddressShort(addr: unknown): string {
  if (typeof addr !== 'string' || addr.length === 0) return '?'
  if (addr.length <= 6) return addr
  return `${addr.slice(0, 6)}…`
}

/** Safely read a string field from `input`, returning fallback if missing. */
function str(
  input: Record<string, unknown>,
  key: string,
  fallback = '?',
): string {
  const v = input[key]
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

/**
 * Best-effort ETH amount formatter.
 *
 * If the tool already passes a human-readable amount (e.g. `"0.5"`), we use
 * it as-is. If it passes a wei value as a `bigint` or a numeric string, we
 * run it through viem's `formatEther`. Returns `"?"` on anything unusable.
 */
function formatEthAmount(raw: unknown): string {
  if (typeof raw === 'bigint') {
    try {
      return formatEther(raw)
    } catch {
      return '?'
    }
  }
  if (typeof raw === 'string' && raw.length > 0) {
    // Heuristic: a decimal point means it's already human-formatted.
    if (raw.includes('.')) return raw
    // Pure digits → interpret as wei.
    if (/^\d+$/.test(raw)) {
      try {
        return formatEther(BigInt(raw))
      } catch {
        return raw
      }
    }
    return raw
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return '?'
}

export function buildHumanSummary(
  name: string,
  input: Record<string, unknown>,
): string {
  switch (name) {
    // ─── read (labelled) ────────────────────────────────────────────────────
    // estimate_gas: the agent passes chain_id, to, and value_wei. The
    // human-readable gas estimate is not known until the tool executes,
    // so we show a generic "Estimating gas" label.
    case 'estimate_gas': {
      const to = truncateAddress(input.to)
      return `Estimate gas for transfer to ${to}`
    }

    // ─── write — chain-agnostic capability sends ────────────────────────────
    // send_native: human-readable `amount` of the active chain's native coin.
    // The server doesn't know the namespace's symbol here, so the label stays
    // coin-agnostic; the mobile receipt card shows the resolved coin.
    case 'send_native': {
      const amount = str(input, 'amount')
      const to = truncateAddress(input.to)
      return `Send ${amount} to ${to}`
    }
    // send_token: `symbol` + human-readable `amount`.
    case 'send_token': {
      const amount = str(input, 'amount')
      const symbol = str(input, 'symbol')
      const to = truncateAddress(input.to)
      return `Send ${amount} ${symbol} to ${to}`
    }

    // ─── write ─────────────────────────────────────────────────────────────
    // send_native_token: `value_wei` is the base-10 amount, `to` is the
    // destination. The agent passes chain_id (integer), not chain_name.
    case 'send_native_token': {
      const amount = formatEthAmount(input.value_wei)
      const to = truncateAddress(input.to)
      return `Send ${amount} ETH to ${to}`
    }

    case 'send_sol': {
      const amount = str(input, 'amount_sol')
      const to = truncateAddress(input.to)
      return `Send ${amount} SOL to ${to}`
    }
    case 'send_sui': {
      const amount = str(input, 'amount_sui')
      const to = truncateAddress(input.to)
      return `Send ${amount} SUI to ${to}`
    }
    case 'send_sui_coin': {
      const amount = str(input, 'token_amount')
      const to = truncateAddress(input.to)
      return `Send ${amount} tokens to ${to}`
    }
    case 'send_spl_token': {
      const amount = str(input, 'token_amount')
      const to = truncateAddress(input.to)
      return `Send ${amount} tokens to ${to}`
    }

    // ─── write — Stellar ────────────────────────────────────────────────────
    // send_xlm: `amount_xlm` is human-readable, `to` is a G… strkey.
    case 'send_xlm': {
      const amount = str(input, 'amount_xlm')
      const to = truncateAddress(input.to)
      return `Send ${amount} XLM to ${to}`
    }
    // send_stellar_asset: `amount` is human-readable, `code` is the asset
    // code (e.g. USDC), `to` is a G… strkey.
    case 'send_stellar_asset': {
      const amount = str(input, 'amount')
      const code = str(input, 'code')
      const to = truncateAddress(input.to)
      return `Send ${amount} ${code} to ${to}`
    }
    // establish_stellar_trustline: opt the connected wallet into holding an
    // asset. No amount — it authorizes future receipts of `code`.
    case 'establish_stellar_trustline': {
      const code = str(input, 'code')
      return `Add a trustline for ${code}`
    }

    // transfer_erc20: `token_amount` is human-readable, `contract_address` is
    // the token. symbol and chain_name are not in the schema (the mobile
    // resolves them from the registry).
    case 'transfer_erc20': {
      const amount = str(input, 'token_amount')
      const to = truncateAddress(input.to)
      return `Send ${amount} tokens to ${to}`
    }

    // write_contract: `contract_address` is the field name in the schema,
    // not `address`.
    case 'write_contract': {
      const fn = str(input, 'function_name')
      const addr = truncateAddressShort(input.contract_address)
      return `Call \`${fn}()\` on ${addr}`
    }

    // approve_erc20: `token_amount` is the field name, not `amount`.
    // symbol is not in the schema.
    case 'approve_erc20': {
      const spender = truncateAddress(input.spender)
      const amount = str(input, 'token_amount')
      return `Approve ${spender} to spend up to ${amount} tokens`
    }

    // ─── points / write ────────────────────────────────────────────────────
    // deposit_points: on-chain token transfer + API deposit registration.
    // The agent MUST have called get_points_price first so `expected_points`
    // is meaningful to the user reading the approval sheet.
    case 'deposit_points': {
      const amount = str(input, 'token_amount')
      const symbol = str(input, 'token_symbol')
      const points = str(input, 'expected_points')
      return `Deposit ${amount} ${symbol} for ~${points} points`
    }

    // deposit_points_sol: Solana counterpart of `deposit_points`. The agent
    // passes `token_mint` instead of a symbol; the approval card resolves the
    // symbol from the mint registry.
    case 'deposit_points_sol': {
      const amount = str(input, 'token_amount')
      const points = str(input, 'expected_points')
      return `Deposit ${amount} tokens for ~${points} points on Solana`
    }

    // execute_redemption: irreversibly spend points on a catalog product.
    case 'execute_redemption': {
      const product = str(input, 'product_name')
      const pointsCost = str(input, 'points_cost')
      return `Redeem ${product} for ${pointsCost} points`
    }

    // execute_booking_sol: TakumiPay booking purchase on Solana. The
    // approval card shows the booking detail (price, product, etc.) — we
    // emit a generic label here so the registry parity test passes and
    // anything that surfaces this string still has something readable.
    case 'execute_booking_sol': {
      const refId = str(input, 'ref_id')
      return `Submit booking ${refId} on Solana`
    }

    // ─── defi / write (stubbed in v1) ───────────────────────────────────
    // The handlers return `{ status: "stubbed", … }` so these summaries
    // are only used by the parity test today, but the labels must stay
    // approval-safe — when the real DeFi backend lands the same string
    // surfaces on the unified PendingTxCard (defi-strategies-spec.md §11).
    case 'defi_deposit': {
      const amount = str(input, 'amount_raw')
      const asset = str(input, 'asset_symbol')
      const slug = str(input, 'protocol_slug')
      return `Deposit ${amount} ${asset} into ${slug}`
    }
    case 'defi_withdraw': {
      // protocol_slug/asset_symbol are optional display hints (propose.ts) —
      // use them when the caller supplied them so this fallback names the
      // protocol/asset instead of a bare position id; mobile's own
      // facts-first card is the primary surface, this string is the
      // last-resort fallback.
      const amount = str(input, 'amount_raw')
      const asset = str(input, 'asset_symbol', '')
      const slug = str(input, 'protocol_slug', '')
      const position = str(input, 'position_id')
      const venue = asset && slug ? `${asset} from ${slug}` : `from position ${position}`
      return `Withdraw ${amount} ${venue}`
    }
    case 'defi_rebalance': {
      const position = str(input, 'from_position_id')
      const target = str(input, 'to_protocol_slug', '')
      return target
        ? `Rebalance position ${position} → ${target}`
        : `Rebalance position ${position}`
    }
    case 'defi_claim': {
      const position = str(input, 'position_id')
      return `Claim rewards on position ${position}`
    }
    case 'defi_cross_chain_deposit': {
      const amount = str(input, 'amount_raw')
      const asset = str(input, 'from_asset_symbol')
      const fromChain = str(input, 'from_chain_id')
      const toChain = str(input, 'to_chain_id')
      const slug = str(input, 'protocol_slug')
      return `Bridge ${amount} ${asset} from chain ${fromChain} → ${toChain} and deposit into ${slug}`
    }
    case 'defi_set_recurring_invest': {
      // Fallback copy only — mobile's facts-first `approvalSummary.ts`
      // renders the real approval text from the tool args
      // (`project_facts_first_approval_summary`). Says "remind" rather than
      // "invest" on purpose: setting up a plan moves no funds today.
      const raw = input.amount_usd
      const amount = typeof raw === 'number' && Number.isFinite(raw) ? raw : '?'
      const cadence = str(input, 'cadence')
      const tier = str(input, 'tier')
      const asset = str(input, 'asset_symbol', '')
      return `Set up a ${cadence} reminder to invest $${amount}${
        asset ? ` of ${asset}` : ''
      } into a ${tier} mix`
    }
    case 'defi_compound': {
      const position = str(input, 'position_id')
      return `Claim rewards on position ${position} and redeposit`
    }

    // ─── bridge (bridge-capability-spec §8.1, §8.3) ─────────────────────────
    // Fallback copy only. The approval surface renders FACTS from the tool
    // args via the mobile `approvalSummary.ts` / `BridgeQuoteCard`; this
    // string is never the primary approval text
    // (`project_facts_first_approval_summary`).
    case 'bridge_execute': {
      const amount = str(input, 'amount_raw')
      const fromChain = str(input, 'from_chain')
      const toChain = str(input, 'to_chain')
      return `Bridge ${amount} from ${fromChain} to ${toChain}`
    }
    case 'bridge_quote': {
      const fromChain = str(input, 'from_chain')
      const toChain = str(input, 'to_chain')
      return `Quote a bridge from ${fromChain} to ${toChain}`
    }
    case 'bridge_status':
      return 'Check the progress of a bridge transfer'
    case 'bridge_get_support':
      return 'Check which chains can be bridged between'

    // ─── defi / Sui Intent Engine (spec §6.2) ───────────────────────────────
    // defi_intent_execute (write): the approval sheet shows this. Generic +
    // approval-safe — the server has only the intent_id at call time, not
    // the compiled APY; the rich copy comes from the mobile result.
    case 'defi_intent_execute':
      return 'Execute your prepared Sui transaction'
    // defi_intent_preview (read): runs silently, but the parity-friendly
    // label keeps every tool mapping to a non-empty summary.
    case 'defi_intent_preview':
      return 'Prepare a Sui transaction from your goal'

    // ─── defi / read (dry-run) ──────────────────────────────────────────────
    case 'defi_simulate_deposit': {
      const amount = str(input, 'amount_raw')
      const asset = str(input, 'asset_symbol')
      const slug = str(input, 'protocol_slug')
      return `Simulate depositing ${amount} ${asset} into ${slug}`
    }

    // x402_fetch: agent-initiated paid-resource micropayment. The model
    // passes a `resource` capability id (the server resolves the URL); the
    // payment settles silently from the pre-authorized allowance, so this
    // summary is informational rather than an approval prompt.
    case 'x402_fetch': {
      const resource = str(input, 'resource', '')
      return resource ? `Buy the "${resource}" resource` : 'Buy a paid resource'
    }

    // ─── points / read (interactive login) ──────────────────────────────────
    // request_authentication: shows login UI on the mobile. No tool inputs.
    case 'request_authentication':
      return 'Log in to TakumiPay'

    // ─── read (silent, non-approval) ───────────────────────────────────────
    // Reads never surface in an approval sheet, but the registry test
    // requires every tool name to map to a non-empty summary string so we
    // stub them out here as simple labels.
    // Chain-agnostic capability reads (the model-facing balance surface).
    case 'get_native_balance':
      return 'Fetch connected wallet balance'
    case 'get_wallet_assets':
      return 'Fetch wallet asset list'
    case 'get_wallet_tokens':
      return 'Fetch wallet token list'
    case 'get_sol_balance':
      return 'Fetch Solana address balance'
    case 'get_wallet_sol_balance':
      return 'Fetch connected wallet SOL balance'
    case 'get_sui_balance':
      return 'Fetch Sui address balance'
    case 'get_wallet_sui_balance':
      return 'Fetch connected wallet SUI balance'
    case 'get_wallet_sui_coins':
      return 'Fetch wallet Sui coin list'
    case 'get_xlm_balance':
      return 'Fetch Stellar address balance'
    case 'get_wallet_xlm_balance':
      return 'Fetch connected wallet XLM balance'
    case 'get_wallet_stellar_assets':
      return 'Fetch wallet Stellar asset list'
    case 'get_redemption_categories':
      return 'Fetch redemption categories'
    case 'get_redemption_catalog':
      return 'Fetch redemption catalog'
    case 'search_redemption_catalog': {
      const term =
        str(input, 'query', '') ||
        str(input, 'name', '') ||
        str(input, 'category', '')
      return term ? `Search catalog for "${term}"` : 'Search redemption catalog'
    }
    case 'get_product_details':
      return 'Fetch redemption product details'
    case 'get_product_input_fields':
      return 'Fetch redemption product input fields'
    case 'get_points_price':
      return 'Fetch points conversion rate'
    case 'get_points_balance':
      return 'Fetch points balance'
    case 'get_points_history':
      return 'Fetch points history'
    case 'get_redemption_status':
      return 'Fetch redemption status'
    case 'get_redemption_history':
      return 'Fetch redemption history'

    default:
      return `Execute ${name}`
  }
}
