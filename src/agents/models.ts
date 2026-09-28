/**
 * Model registry — the single place that maps a stable model id to a
 * concrete `ai` SDK `LanguageModel`.
 *
 * Design goal: adding a new model is a `MODEL_IDS` row + a `REGISTRY`
 * factory + its `EFFORT_SUPPORT` / `PROVIDER_OF` rows (the `Record<ModelId>`
 * types make a missing row a compile error), and nothing else moves.
 * Agents reference a `ModelId` constant in their `config.ts`; they never
 * touch a provider directly. Model choice is server-side only.
 *
 * Providers are lazy: a factory (and its API-key check) only runs when an
 * agent actually selects that model, so a Kimi-only deployment never needs
 * `ANTHROPIC_API_KEY`, and vice-versa.
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { Logger } from '@nestjs/common'
import type { LanguageModel } from 'ai'
import { clampEffort, type EffortLevel } from './effort'

const logger = new Logger('AgentModels')

/**
 * Stable ids agents pick from. The string value is opaque — keep it short
 * and human-readable; the real provider model name lives in the factory.
 *
 * To add a model: add a row here AND matching `REGISTRY`, `EFFORT_SUPPORT`
 * and `PROVIDER_OF` rows.
 */
export const MODEL_IDS = {
  KIMI_K2: 'kimi-k2',
  CLAUDE_SONNET: 'claude-sonnet',
  // GPT_5: 'gpt-5',            // ← future: add a row + a REGISTRY factory, done.
} as const

export type ModelId = (typeof MODEL_IDS)[keyof typeof MODEL_IDS]

/**
 * Thrown when a selected model can't be built (missing API key / unknown
 * id). The raw cause is logged; callers map this to friendly copy before
 * it reaches a user (CLAUDE.md user-facing-error rule).
 */
export class ModelNotConfiguredError extends Error {
  constructor(public readonly modelId: string) {
    super(`model_not_configured:${modelId}`)
    this.name = 'ModelNotConfiguredError'
  }
}

function requireEnv(key: string, modelId: string): string {
  const value = process.env[key]
  if (!value) {
    logger.error(
      `Model "${modelId}" selected but ${key} is not set — refusing to build it.`,
    )
    throw new ModelNotConfiguredError(modelId)
  }
  return value
}

// ── Providers (each owns its vendor SDK + env key + base config) ──────────

/**
 * Moonshot / Kimi via the OpenAI-compatible endpoint.
 *
 * Kimi K2.6 enables deep thinking by default; when thinking is on, every
 * assistant tool-call must carry its `reasoning_content` into the next
 * turn or Moonshot 400s. Our loops rebuild assistant messages from text +
 * tool-call parts only, so we force `thinking: { type: 'disabled' }` by
 * patching the outgoing JSON body in the provider's fetch hook. (Preserved
 * verbatim from the original `ChatService.getModel`.)
 */
function moonshotProvider() {
  const apiKey = requireEnv('KIMI_K2_API_KEY', MODEL_IDS.KIMI_K2)
  return createOpenAI({
    apiKey,
    baseURL: 'https://api.moonshot.ai/v1',
    fetch: async (input, init) => {
      let outBody = init?.body
      if (init?.body && typeof init.body === 'string') {
        try {
          const body = JSON.parse(init.body) as Record<string, unknown>
          body.thinking = { type: 'disabled' }
          // NOTE: do NOT set `frequency_penalty`/`presence_penalty` here —
          // kimi-k2.6 rejects any non-zero value ("only 0 is allowed for this
          // model", HTTP 400). Repetition is curbed via the prompt/coordination
          // rules (scoped briefs, silent Core, re-delegation guard) instead.
          outBody = JSON.stringify(body)
        } catch {
          // Non-JSON body — leave untouched.
        }
      }
      // 60-second per-attempt timeout so transient TCP hangs (ETIMEDOUT)
      // fail fast and the AI SDK's maxRetries can actually rotate instead of
      // all three attempts waiting for the OS-level socket timeout (~2 min).
      const timeoutSignal = AbortSignal.timeout(60_000)
      const signal = init?.signal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : timeoutSignal
      const startedAt = Date.now()
      try {
        const res = await fetch(input as RequestInfo, {
          ...init,
          body: outBody,
          signal,
        })
        logger.log(
          `[moonshot] status=${res.status} dur=${Date.now() - startedAt}ms`,
        )
        return res
      } catch (err) {
        logger.error(
          `[moonshot] FAILED dur=${Date.now() - startedAt}ms: ${(err as Error).message}`,
        )
        throw err
      }
    },
  })
}

/** Anthropic / Claude. Lazy — only needs `ANTHROPIC_API_KEY` if selected. */
function anthropicProvider() {
  const apiKey = requireEnv('ANTHROPIC_API_KEY', MODEL_IDS.CLAUDE_SONNET)
  return createAnthropic({ apiKey })
}

// ── Registry: id → lazy factory ──────────────────────────────────────────

const REGISTRY: Record<ModelId, () => LanguageModel> = {
  [MODEL_IDS.KIMI_K2]: () => moonshotProvider().chat('kimi-k2.6'),
  [MODEL_IDS.CLAUDE_SONNET]: () => anthropicProvider()('claude-sonnet-4-6'),
}

/** `streamText` providerOptions carrying a native effort level. */
export type EffortProviderOptions = Record<string, Record<string, string>>

/**
 * Native effort levels each model accepts. Empty = no native control; the
 * harness half of effort (`EFFORT_PROFILES`) still applies. A new model row
 * adds its entry here — nothing else changes.
 */
const EFFORT_SUPPORT: Record<ModelId, readonly EffortLevel[]> = {
  [MODEL_IDS.KIMI_K2]: [],
  // claude-sonnet-4-6: `xhigh` arrived with Opus 4.7, so it tops out at max
  // with no xhigh — clampEffort maps an xhigh request down to high.
  [MODEL_IDS.CLAUDE_SONNET]: ['low', 'medium', 'high', 'max'],
}

/** Provider for each model id — selects the `providerOptions` namespace. */
const PROVIDER_OF: Record<ModelId, 'moonshot' | 'anthropic'> = {
  [MODEL_IDS.KIMI_K2]: 'moonshot',
  [MODEL_IDS.CLAUDE_SONNET]: 'anthropic',
}

/**
 * The model half of per-agent effort: the `providerOptions` to pass to
 * `streamText`, or undefined when the model has no native effort knob.
 */
export function providerOptionsFor(
  id: ModelId,
  effort: EffortLevel | undefined,
): EffortProviderOptions | undefined {
  if (!effort) return undefined
  const level = clampEffort(effort, EFFORT_SUPPORT[id] ?? [])
  if (!level) return undefined
  if (PROVIDER_OF[id] === 'anthropic') return { anthropic: { effort: level } }
  return undefined
}

const cache = new Map<ModelId, LanguageModel>()

/**
 * Resolve a `ModelId` to a cached `LanguageModel`. Throws
 * `ModelNotConfiguredError` (logged) if the id is unknown or its provider
 * key is missing — callers surface friendly copy.
 */
export function resolveModel(id: ModelId): LanguageModel {
  const cached = cache.get(id)
  if (cached) return cached
  const factory = REGISTRY[id]
  if (!factory) {
    logger.error(`Unknown model id "${id}" — not in REGISTRY.`)
    throw new ModelNotConfiguredError(id)
  }
  const model = factory()
  cache.set(id, model)
  return model
}

/** Test-only — drop cached provider instances between cases. */
export function __resetModelCacheForTests(): void {
  cache.clear()
}
