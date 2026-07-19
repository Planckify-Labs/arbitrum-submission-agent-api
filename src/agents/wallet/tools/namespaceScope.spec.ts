import { WALLET_TOOLS } from './index';
import {
  namespaceOfTool,
  scopeToolsForModel,
  scopeToolsToNamespace,
  SUPERSEDED_BY_CAPABILITY,
} from './namespaceScope';

describe('namespaceScope', () => {
  describe('namespaceOfTool', () => {
    it('classifies the non-EVM namespace tools structurally', () => {
      expect(namespaceOfTool('get_wallet_sol_balance')).toBe('solana');
      expect(namespaceOfTool('get_wallet_sui_balance')).toBe('sui');
      expect(namespaceOfTool('get_wallet_xlm_balance')).toBe('stellar');
      expect(namespaceOfTool('get_wallet_stellar_assets')).toBe('stellar');
    });

    it('classifies the EVM-only tools as eip155', () => {
      expect(namespaceOfTool('get_wallet_balance')).toBe('eip155');
      expect(namespaceOfTool('get_wallet_tokens')).toBe('eip155');
      expect(namespaceOfTool('transfer_erc20')).toBe('eip155');
    });

    it('leaves namespace-agnostic tools unclassified', () => {
      expect(namespaceOfTool('get_wallet_address')).toBeUndefined();
      expect(namespaceOfTool('get_supported_chains')).toBeUndefined();
      expect(namespaceOfTool('x402_fetch')).toBeUndefined();
    });
  });

  describe('scopeToolsToNamespace', () => {
    it('drops sibling-namespace tools on a Stellar wallet, keeps Stellar + agnostic', () => {
      const scoped = scopeToolsToNamespace(WALLET_TOOLS, 'stellar');
      const names = Object.keys(scoped);

      // Stellar survives.
      expect(names).toContain('get_wallet_xlm_balance');
      expect(names).toContain('get_wallet_stellar_assets');
      expect(names).toContain('send_xlm');

      // Every other namespace's balance/token tools are gone — this is the
      // exact set that produced the `unsupported_chain` error cards.
      for (const gone of [
        'get_wallet_balance',
        'get_wallet_tokens',
        'get_wallet_sol_balance',
        'get_wallet_spl_tokens',
        'get_wallet_sui_balance',
        'get_wallet_sui_coins',
      ]) {
        expect(names).not.toContain(gone);
      }

      // Agnostic tools always survive.
      expect(names).toContain('get_wallet_address');
      expect(names).toContain('x402_fetch');
    });

    it('keeps EVM tools and drops non-EVM ones on an eip155 wallet', () => {
      const scoped = scopeToolsToNamespace(WALLET_TOOLS, 'eip155');
      const names = Object.keys(scoped);
      expect(names).toContain('get_wallet_balance');
      expect(names).toContain('get_wallet_tokens');
      expect(names).not.toContain('get_wallet_xlm_balance');
      expect(names).not.toContain('get_wallet_sui_balance');
    });

    it('treats an omitted namespace as eip155 (legacy clients)', () => {
      const scoped = scopeToolsToNamespace(WALLET_TOOLS, undefined);
      const names = Object.keys(scoped);
      expect(names).toContain('get_wallet_balance');
      expect(names).not.toContain('get_wallet_xlm_balance');
    });

    it('does not mutate the input registry', () => {
      const before = Object.keys(WALLET_TOOLS).length;
      scopeToolsToNamespace(WALLET_TOOLS, 'stellar');
      expect(Object.keys(WALLET_TOOLS).length).toBe(before);
    });
  });

  describe('scopeToolsForModel', () => {
    it('exposes the capability tools and hides the superseded per-namespace ones', () => {
      const scoped = scopeToolsForModel(WALLET_TOOLS, 'stellar');
      const names = Object.keys(scoped);

      // The chain-agnostic capability tools ARE the model-facing surface.
      expect(names).toContain('get_native_balance');
      expect(names).toContain('get_wallet_assets');

      // None of the superseded per-namespace balance/token tools reach the model.
      for (const superseded of SUPERSEDED_BY_CAPABILITY) {
        expect(names).not.toContain(superseded);
      }
    });

    it('still hides superseded EVM tools on an eip155 wallet', () => {
      const names = Object.keys(scopeToolsForModel(WALLET_TOOLS, 'eip155'));
      expect(names).toContain('get_native_balance');
      expect(names).toContain('get_wallet_assets');
      expect(names).not.toContain('get_wallet_balance');
      expect(names).not.toContain('get_wallet_tokens');
    });

    it('keeps namespace-agnostic and address-lookup tools available', () => {
      const names = Object.keys(scopeToolsForModel(WALLET_TOOLS, 'stellar'));
      // arbitrary-address reader stays (different capability, explicit address)
      expect(names).toContain('get_xlm_balance');
      // agnostic tools stay
      expect(names).toContain('get_wallet_address');
      expect(names).toContain('x402_fetch');
    });

    it('every superseded tool still exists in the full registry (only hidden)', () => {
      for (const superseded of SUPERSEDED_BY_CAPABILITY) {
        expect(WALLET_TOOLS[superseded]).toBeDefined();
      }
    });
  });
});
