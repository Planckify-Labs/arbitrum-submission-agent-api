/**
 * `core_clarify` — Core's "ask the user a clarifying question" tool.
 *
 * Spec: docs/multi-agent-architecture-spec.md §4.1, §6.1.
 *
 * In-process tool. The orchestrator short-circuits invocations of this
 * tool: it never emits a `tool_pending` to mobile and never reaches a
 * specialist. The output is just the structured question Core wants to
 * pose; the next turn re-enters Core with the user's reply.
 *
 * Hard rule (§4.1): no imports from `services/walletKit`, `services/chains`,
 * `services/defi`, or any external-capability module. Pure data.
 */

import { composeAgentTools } from '../../../tools/internal/compose'
import type { ToolMeta } from '../../../tools/internal/types'

const CORE_CLARIFY: ToolMeta = {
  name: 'core_clarify',
  category: 'utility',
  executor: 'server',
  capability: 'read',
  description:
    'Ask the user ONE question — only when you cannot tell WHICH task they want (kind "which_task"). You have no tools to look anything up, so never ask for a detail a specialist could resolve (recipient, token, amount source, chain): hand off instead. If you think a detail is missing, set kind "missing_detail" and likely_agent — the request is then handed to that specialist, which resolves it with its tools and only asks if it truly must.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['which_task', 'missing_detail'],
        description:
          '"which_task": you cannot tell what the user wants done (asked verbatim). "missing_detail": the task is clear but a parameter seems missing (NOT asked — routed to likely_agent).',
      },
      likely_agent: {
        type: 'string',
        description:
          'Specialist id that owns the task (e.g. "wallet", "defi"). Required for kind "missing_detail".',
      },
      question: {
        type: 'string',
        description:
          'The clarifying question to ask the user (≤ 200 chars). Hand-written, never echoing raw tool output.',
      },
      reason: {
        type: 'string',
        description:
          'Optional brief internal note explaining why the clarification is needed. Not shown to the user.',
      },
    },
    required: ['kind', 'question'],
    additionalProperties: false,
  },
}

export const CORE_CLARIFY_TOOLS: Record<string, ToolMeta> = composeAgentTools(
  'core',
  {
    core_clarify: CORE_CLARIFY,
  },
)
