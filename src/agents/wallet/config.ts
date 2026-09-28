/**
 * Wallet specialist runtime config.
 *
 * Change the model constant below to run this agent on any id in `MODEL_IDS`.
 */

import type { AgentRuntimeConfig } from '../agentConfig'
import { MODEL_IDS } from '../models'
import { WALLET_TOOLS } from './tools'
import { WALLET_SYSTEM_PROMPT } from './systemPrompt'

export const walletConfig: AgentRuntimeConfig = {
  id: 'wallet',
  model: MODEL_IDS.KIMI_K2,
  buildSystemPrompt: () => WALLET_SYSTEM_PROMPT,
  tools: WALLET_TOOLS,
  // Redemption flows (balance → catalog → product → fields → price →
  // execute → status) need the full 16-step budget; don't go below high.
  effort: 'high',
  skills: ['pay-a-person', 'fiat-amount'],
}
