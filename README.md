# TakumiPay agent service (Arbitrum submission)

> Part of the TakumiPay submission to the Arbitrum Open House Singapore Online Buildathon. Start at the hub: **[https://github.com/Planckify-Labs/arbitrum-submission](https://github.com/Planckify-Labs/arbitrum-submission)** (fact sheet, deployments with transaction hashes, known limitations, reproduction commands).

**Role of this repository:** NestJS service behind the in-app Takumi Agent. The agent proposes wallet actions; the mobile app executes them only after user approval.

**Chains:** Arbitrum One (42161), Arbitrum Sepolia (421614), Robinhood Chain testnet (46630). **Stablecoin:** Paxos USDG. **License:** GPL-3.0.

## Where to look
- Orchestrator and routing: `src/agents/orchestrator.ts`, `src/agents/engine.ts`
- Per-agent prompts and tools: `src/agents/wallet/`, `src/agents/defi/`, `src/agents/core/`
- Model wiring (Kimi K2.6 through Moonshot): `src/agents/models.ts`
- Output leak filter: `src/agents/leakFilter.ts`

## Run
```bash
cp .env.example .env   # needs your own model and speech keys
pnpm install
pnpm dev
```

## Authentication
Requests carry the shared API key in `x-api-key` or `Authorization: Bearer <key>`. Requests without it get `401`.

## History note
The commit history of this repository was rewritten to remove a previously committed production environment file, so hashes differ from the private development repository.

---

