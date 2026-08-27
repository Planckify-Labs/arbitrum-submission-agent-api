/**
 * `defi_set_recurring_invest` — DCA v1 (mobile-app
 * docs/defi-quick-invest-spec.md §12.5).
 *
 * Sets up a recurring REMINDER, not automated investing. On each cycle the
 * server pushes a nudge, the user taps once, and the user's own key signs
 * through the existing `defi_deposit` approval flow. **No signing
 * authority is created, delegated, or stored anywhere** — §13's unattended
 * variant is deliberately out of scope and needs its own security review.
 *
 * The model supplies only what the USER said: amount, tier, cadence, and
 * the asset. The wallet and the chain come from the device's active wallet
 * inside the executor, never from the model — same posture as "no
 * LLM-supplied addresses" everywhere else in this app.
 *
 * Mobile executor: `services/agent-executors/defi/recurring.ts`.
 */

import { composeAgentTools } from '../../../tools/internal/compose'
import type { ToolMeta } from '../../../tools/internal/types'

const DEFI_SET_RECURRING_INVEST: ToolMeta = {
  name: 'defi_set_recurring_invest',
  category: 'utility',
  executor: 'mobile',
  capability: 'write',
  description:
    'Set up a recurring investing plan ("invest $25 a week", "put $100 into DeFi every month", "set up a monthly DCA"). This creates a REMINDER, not an automatic transfer: on each cycle the user gets a notification and still approves and signs the deposit themselves, so nothing moves without them. Call it ONLY when the user asks for something recurring — a one-off "invest $500" is `defi_list_opportunities` followed by a deposit, never this. Do NOT call it to deposit money now; setting up a plan moves no funds today. Pass ONLY what the user actually said: never invent an amount or a cadence, and ask for whichever is missing instead of guessing. The wallet and chain come from the device, not from you.',
  inputSchema: {
    type: 'object',
    properties: {
      amount_usd: {
        type: 'number',
        description:
          'Amount to invest each cycle, in USD, exactly as the user stated it. Never invent this: it becomes a standing order the user sees repeat.',
        minimum: 1,
      },
      tier: {
        type: 'string',
        enum: ['conservative', 'balanced', 'aggressive'],
        description:
          'Risk tier for the plan. Infer it from a stated goal when the user gave one ("emergency fund" → conservative, "grow it" → aggressive); default to "balanced" only when they expressed no preference at all.',
      },
      cadence: {
        type: 'string',
        enum: ['weekly', 'monthly'],
        description:
          'How often to remind. Weekly or monthly only: a shorter cycle lets gas eat a meaningful share of a small recurring deposit. If the user asked for something else ("every 3 days"), say those are the two options rather than rounding silently.',
      },
      asset_symbol: {
        type: 'string',
        description:
          'Asset to invest each cycle, e.g. "USDC". Omit it and the device uses the asset the user is actually holding on their active chain.',
      },
    },
    required: ['amount_usd', 'tier', 'cadence'],
    additionalProperties: false,
  },
}

const DEFI_LIST_RECURRING_INVEST: ToolMeta = {
  name: 'defi_list_recurring_invest',
  category: 'utility',
  executor: 'mobile',
  capability: 'read',
  description:
    'List the user\'s recurring investing plans ("what plans do I have", "am I still investing weekly", "cancel my DCA" — read first, then act). Each row reports the plan\'s own risk tier AND the tier that will actually be applied: if the user changed their saved risk profile after setting the plan up, the saved profile wins, and you must say so plainly rather than letting it happen silently. The result renders as a card that already shows amount, cadence, chain and next date — do not re-tabulate it.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
}

export const DEFI_RECURRING_TOOLS: Record<string, ToolMeta> = composeAgentTools(
  'defi',
  {
    defi_set_recurring_invest: DEFI_SET_RECURRING_INVEST,
    defi_list_recurring_invest: DEFI_LIST_RECURRING_INVEST,
  },
)
