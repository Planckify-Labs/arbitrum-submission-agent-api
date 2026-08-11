/**
 * Namespace scoping for the wallet tool set.
 *
 * A wallet turn is pinned to EXACTLY ONE chain namespace via
 * `wallet_context.namespace` (spec §9 / CLAUDE.md "dApp bridge isolation").
 * The device holds a single active wallet, so the tool variants for OTHER
 * namespaces can never succeed — their mobile executors reject with
 * `unsupported_chain`. Handing them to the model anyway wastes tokens and,
 * worse, invites the model to fan out on a broad query ("what do I own?")
 * and fire every balance/token tool, surfacing a row of scary
 * "COULDN'T READ BALANCES · unsupported_chain" cards to the user.
 *
 * So we filter the tool set down to the active namespace before the turn:
 * a tool that BELONGS to a namespace survives only when that namespace is
 * active; namespace-agnostic tools (points, address book, redemptions,
 * x402, `get_wallet_address`, …) always survive.
 *
 * This is a hard, deterministic guard — the tool-description hints
 * ("Use this when wallet_context.namespace is …") remain as belt-and-suspenders.
 *
 * The non-EVM namespaces each own a dedicated tool file, so their tool
 * names are derived structurally from the group keys (no drift). EVM tools
 * are interleaved with agnostic ones inside `reads.ts` / `writes.ts`, so
 * the EVM-only names are listed explicitly below.
 */

import type { ToolMeta } from '../../../tools/internal/types';
import { WALLET_SOLANA_TOOLS } from './solana';
import { WALLET_STELLAR_TOOLS } from './stellar';
import { WALLET_SUI_TOOLS } from './sui';

export type ChainNamespace = 'eip155' | 'solana' | 'sui' | 'stellar';

/**
 * EVM-only wallet tools. These live in `reads.ts` / `writes.ts` alongside
 * namespace-agnostic tools, so unlike Solana/Sui/Stellar they can't be
 * derived from a whole-file group and are enumerated here.
 *
 * `get_supported_chains` / `get_wallet_address` are intentionally NOT here —
 * they're informational and harmless on any namespace, so they stay agnostic.
 * A future EVM tool missing from this set degrades gracefully (it simply
 * isn't scoped out) rather than breaking non-EVM turns.
 */
const EVM_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  'get_balance',
  'get_wallet_balance',
  'get_wallet_tokens',
  'get_transaction',
  'read_contract',
  'estimate_gas',
  'send_native_token',
  'transfer_erc20',
  'approve_erc20',
  'write_contract',
]);

const SOLANA_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.keys(WALLET_SOLANA_TOOLS),
);
const SUI_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.keys(WALLET_SUI_TOOLS),
);
const STELLAR_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.keys(WALLET_STELLAR_TOOLS),
);

/**
 * The namespace a tool belongs to, or `undefined` when it is
 * namespace-agnostic (available on every namespace).
 *
 * `bridge_*` and `defi_*` deliberately classify as agnostic, and that is
 * NOT an oversight to be tidied up later. They are the tools that take a
 * chain as an ARGUMENT (`from_chain` / `to_chain`, a pool's namespace)
 * rather than inheriting one from the active wallet — a bridge is
 * cross-chain by definition. Binding them to a single namespace here
 * would hide bridging from every turn whose active chain didn't happen
 * to match, which removes the feature instead of scoping it.
 *
 * Their real constraint is "the user must hold a wallet on the chain
 * named in the argument", which is a fact about arguments, not about
 * which tools exist. That is enforced in two places: the model is told
 * the inventory up front (`owned_namespaces` → "Wallets available on"
 * in `buildWalletContextPrompt`), and the device fails closed with a
 * curated `no_wallet_on_destination_chain` if it proposes one anyway.
 */
export function namespaceOfTool(name: string): ChainNamespace | undefined {
  if (STELLAR_TOOL_NAMES.has(name)) return 'stellar';
  if (SUI_TOOL_NAMES.has(name)) return 'sui';
  if (SOLANA_TOOL_NAMES.has(name)) return 'solana';
  if (EVM_ONLY_TOOL_NAMES.has(name)) return 'eip155';
  return undefined;
}

/**
 * Per-namespace connected-wallet balance / token tools that the
 * chain-agnostic capability tools (`get_native_balance`, `get_wallet_assets`
 * — see `capabilities.ts`) now supersede on the MODEL-FACING surface.
 *
 * They stay fully REGISTERED (mobile executors, result-shapes, registry
 * parity, history replay all unchanged) — we only hide them from the LLM so
 * the model has ONE balance tool + ONE asset-list tool instead of a
 * per-namespace fan of near-duplicates. The capability tools delegate to
 * these exact executors on the device.
 *
 * NOTE: the arbitrary-ADDRESS readers (`get_balance`, `get_sol_balance`,
 * `get_sui_balance`, `get_xlm_balance`) are intentionally NOT here — they
 * answer a different question ("look up someone else's balance") and take an
 * explicit address, so they remain useful and are still namespace-scoped.
 */
export const SUPERSEDED_BY_CAPABILITY: ReadonlySet<string> = new Set([
  // → get_native_balance
  'get_wallet_balance',
  'get_wallet_sol_balance',
  'get_wallet_sui_balance',
  'get_wallet_xlm_balance',
  // → get_wallet_assets
  'get_wallet_tokens',
  'get_wallet_spl_tokens',
  'get_wallet_sui_coins',
  'get_wallet_stellar_assets',
  // → send_native
  'send_native_token',
  'send_sol',
  'send_sui',
  'send_xlm',
  // → send_token
  'transfer_erc20',
  'send_spl_token',
  'send_sui_coin',
  'send_stellar_asset',
  // NOTE: `establish_stellar_trustline` stays model-visible — it is a
  // Stellar-only opt-in with no cross-chain capability equivalent.
]);

/**
 * Tools that stay fully REGISTERED (mobile executors, registry parity,
 * history replay, card `tool_prefixes` all unchanged) but are hidden from
 * the LLM's model-facing tool set — the agent is never offered them, so it
 * can never call them.
 *
 * `x402_fetch` (agent-initiated x402 micropayments) is turned OFF in agent
 * mode here. The whole x402 stack stays intact — the mobile executor, the
 * resource catalog, the settlement rails, and the user-initiated x402
 * payment flows (QR / nanopay) are untouched — we only stop the agent from
 * autonomously spending the pre-signed allowance. Re-enable by removing the
 * entry.
 *
 * `scopeToolsForModel` also hides any tool carrying an `x402` marker
 * (`ToolMeta.x402`), so a future x402-backed tool is covered by intent
 * without editing this set.
 */
export const HIDDEN_FROM_MODEL: ReadonlySet<string> = new Set([
  // agent-initiated x402 micropayments (Phase 5) — disabled in agent mode.
  'x402_fetch',
]);

/**
 * Drop every namespace-bound tool that does not belong to `active`, keeping
 * namespace-agnostic tools untouched. A missing/legacy namespace is treated
 * as `eip155` (the pre-v1.1 default — see `WalletContext`).
 *
 * Pure: returns a new object; `tools` is not mutated. Applying it to a
 * non-wallet agent's tools is a safe no-op (their names classify as agnostic).
 */
export function scopeToolsToNamespace(
  tools: Record<string, ToolMeta>,
  active: ChainNamespace | undefined,
): Record<string, ToolMeta> {
  const ns: ChainNamespace = active ?? 'eip155';
  const out: Record<string, ToolMeta> = {};
  for (const [name, meta] of Object.entries(tools)) {
    const owner = namespaceOfTool(name);
    if (owner === undefined || owner === ns) {
      out[name] = meta;
    }
  }
  return out;
}

/**
 * The full model-facing filter for a wallet turn: scope to the active
 * namespace, drop tools superseded by the capability tools, and drop tools
 * hidden from the model (`HIDDEN_FROM_MODEL` + any `x402`-marked tool — see
 * that set). This is what the engine hands the LLM. All passes are pure and
 * order-independent.
 */
export function scopeToolsForModel(
  tools: Record<string, ToolMeta>,
  active: ChainNamespace | undefined,
): Record<string, ToolMeta> {
  const scoped = scopeToolsToNamespace(tools, active);
  const out: Record<string, ToolMeta> = {};
  for (const [name, meta] of Object.entries(scoped)) {
    if (
      SUPERSEDED_BY_CAPABILITY.has(name) ||
      HIDDEN_FROM_MODEL.has(name) ||
      meta.x402
    ) {
      continue;
    }
    out[name] = meta;
  }
  return out;
}
