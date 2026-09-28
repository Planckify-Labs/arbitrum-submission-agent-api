/**
 * Agent regression eval — the safety net for every prompt / skill / tool-
 * description change. Runs each case against the REAL models through the
 * exact prompts production builds, emulating `orchestrate()`:
 *
 *   Core hop → every delegated specialist step in order (sharing one
 *   transcript, like `session.messages`) → Core resumes with the step
 *   ledger → … (each specialist at most once, MAX_COORDINATION_HOPS cap).
 *
 * Tool calls are answered by the simulated phone in `evals/fixtures.ts`.
 * The first WRITE tool ends the run: that call is the outcome under test
 * (on a phone it would open the approval sheet).
 *
 * Cases: `evals/cases/*.json` (capabilities) + `src/skills/<name>/cases.json`.
 * It costs real model calls, so it is NOT part of `pnpm test`.
 *
 *   pnpm eval:agents                        # every case once
 *   pnpm eval:agents --runs 3               # 3x each (models are stochastic)
 *   pnpm eval:agents --case swap-relative   # one case (repeatable flag)
 *   pnpm eval:agents --out evals/results/baseline.json
 *   pnpm eval:agents --compare evals/results/baseline.json
 *   pnpm eval:agents --rpm 20                # model calls per minute (default 30)
 *
 * The Moonshot quota is shared with the live app: keep --rpm well under the
 * org limit. Rate limits / timeouts are retried with backoff; a run that
 * still fails on infra is reported as ERROR and excluded from the score.
 *
 * Exit code is non-zero if any run fails, or with --compare, if any case
 * scores below the baseline.
 */

import 'dotenv/config'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { generateText, type ModelMessage } from 'ai'
import { AGENT_CONFIGS, listSpecialistIds } from '../src/agents/agentConfig'
import { CORE_CONTINUATION_NOTE } from '../src/agents/core/systemPrompt'
import { effortProfile } from '../src/agents/effort'
import { decideCoreRoute, type StepResult } from '../src/agents/engine'
import { stripMachineryLeak } from '../src/agents/leakFilter'
import { loadAgentCards } from '../src/agents/loadAgentCards'
import { providerOptionsFor, resolveModel } from '../src/agents/models'
import { MAX_COORDINATION_HOPS } from '../src/agents/orchestrator'
import { scopeToolsForModel } from '../src/agents/wallet/tools/namespaceScope'
import {
  buildAllTools,
  buildSchemaToolSet,
  composeAgentSystem,
  formatStepLedger,
} from '../src/chat.service'
import type { WalletContext } from '../src/session/types'
import { allSkills, SKILLS_DIR } from '../src/skills/loader'
import { TOOL_REGISTRY } from '../src/tools/registry'
import { defaultFixture, scenarioWallet } from '../evals/fixtures'

const ROOT = resolve(__dirname, '..')

export interface EvalCase {
  id: string
  note?: string
  /** Wallet setup from evals/fixtures.ts. Default "monad". */
  scenario?: string
  /** Fields merged over the scenario's wallet_context. */
  wallet?: Partial<WalletContext>
  /** Prior text-only turns. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  user: string
  fixtures?: Record<string, unknown>

  /** Agents Core delegates to, in order ([] = Core answers itself). */
  expect_routes?: string[]
  expect_routes_unordered?: string[]
  /** Legacy single-route form (skills cases). */
  expect_route?: string
  /** Every listed tool is called ("a|b" = either). */
  expect_tools?: string[]
  /** Listed tools are called before the first user-facing text. */
  expect_tools_before_text?: string[]
  /** Listed tools occur in this relative order. */
  expect_tool_order?: string[]
  expect_first_tool?: string
  expect_final_tool?: string
  /** Checks the LAST call's input (dotted paths ok). "a|b" = any; numbers compare numerically. */
  expect_final_input?: Record<string, string>
  /** Checks the FIRST call of each tool. Also "!absent" / "!present". */
  expect_input?: Record<string, Record<string, string>>
  expect_no_tool?: string | string[]
  expect_max_calls?: Record<string, number>
  /** The turn ends on a reply to the user with no write attempted. */
  expect_question?: boolean
  /** Final reply is at most a couple of sentences: no table, no list. */
  expect_short_reply?: boolean
  /** Case-insensitive substrings the user must never see. */
  forbid_text?: string[]
}

interface Call {
  agent: string
  name: string
  input: Record<string, unknown>
}

interface Trace {
  routes: string[]
  coreAnswer?: string
  calls: Call[]
  /** Index into `calls` at which the first user-facing text appeared. */
  firstTextAt?: number
  texts: string[]
  wrote: boolean
  inputTokens: number
  /** Input tokens served from the provider's prefix cache. */
  cachedInputTokens: number
  outputTokens: number
  modelCalls: number
}

// ── Case loading ──────────────────────────────────────────────────────────

function loadCases(): EvalCase[] {
  const out: EvalCase[] = []
  const dir = join(ROOT, 'evals/cases')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    out.push(...(JSON.parse(readFileSync(join(dir, f), 'utf8')) as { cases: EvalCase[] }).cases)
  }
  for (const skill of allSkills().keys()) {
    const path = join(SKILLS_DIR, skill, 'cases.json')
    if (existsSync(path)) {
      out.push(...(JSON.parse(readFileSync(path, 'utf8')) as { cases: EvalCase[] }).cases)
    }
  }
  const seen = new Set<string>()
  for (const c of out) {
    if (seen.has(c.id)) throw new Error(`duplicate eval case id "${c.id}"`)
    seen.add(c.id)
  }
  return out
}

// ── Model calls: throttled, infra errors retried ──────────────────────────

/**
 * The Moonshot org quota (100 RPM at the time of writing) is SHARED with
 * the live app. An unthrottled eval both starves real users and records
 * 429s as agent failures. Every model call goes through this gate.
 */
let minIntervalMs = 2_000
let nextSlot = 0

async function throttle(): Promise<void> {
  const now = Date.now()
  const at = Math.max(now, nextSlot)
  nextSlot = at + minIntervalMs
  if (at > now) await new Promise((r) => setTimeout(r, at - now))
}

/** Rate limits, timeouts, 5xx: not the agent's fault. */
export class InfraError extends Error {}

function isInfra(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err).toLowerCase()
  return /rate limit|max rpm|429|timeout|timed out|etimedout|econnreset|503|502|overloaded|fetch failed/.test(msg)
}

/**
 * Budget / billing / auth errors will not clear with a retry, and every
 * further call spends against a project that may be shared with the live
 * app. Abort the whole run on the first one.
 */
function isFatal(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err).toLowerCase()
  return /consumption budget|exceeded.*budget|insufficient balance|billing|quota|invalid api key|unauthorized|401/.test(msg)
}

async function callModel(params: Parameters<typeof generateText>[0]): ReturnType<typeof generateText> {
  const backoff = [5_000, 15_000, 30_000, 60_000]
  for (let attempt = 0; ; attempt++) {
    await throttle()
    try {
      return await generateText({ ...params, maxRetries: 0 })
    } catch (err) {
      if (isFatal(err)) {
        console.error(`\nABORTING: provider refused on billing/auth, not retrying: ${(err as Error).message}`)
        process.exit(2)
      }
      if (!isInfra(err)) throw err
      if (attempt >= backoff.length) throw new InfraError((err as Error).message)
      await new Promise((r) => setTimeout(r, backoff[attempt]))
    }
  }
}

// ── Orchestrator emulation ────────────────────────────────────────────────

function track(
  trace: Trace,
  usage: {
    inputTokens?: number
    outputTokens?: number
    inputTokenDetails?: { cacheReadTokens?: number }
  },
): void {
  trace.inputTokens += usage.inputTokens ?? 0
  trace.cachedInputTokens += usage.inputTokenDetails?.cacheReadTokens ?? 0
  trace.outputTokens += usage.outputTokens ?? 0
  trace.modelCalls++
}

function fixture(c: EvalCase, scenario: string, tool: string, input: Record<string, unknown>): unknown {
  return c.fixtures?.[tool] ?? defaultFixture(scenario, tool, input)
}

/** Runs one specialist step; returns its user-visible text. */
async function runSpecialist(
  c: EvalCase,
  scenario: string,
  wallet: WalletContext,
  agentId: string,
  brief: string,
  transcript: ModelMessage[],
  trace: Trace,
): Promise<string> {
  const config = AGENT_CONFIGS[agentId]
  const tools = buildAllTools(scopeToolsForModel(config.tools, wallet.namespace), {})
  const system = composeAgentSystem(wallet, config, brief)
  const providerOptions = providerOptionsFor(config.model, config.effort)
  let said = ''

  for (let step = 0; step < effortProfile(config.effort).maxIterations; step++) {
    const res = await callModel({
      model: resolveModel(config.model),
      system,
      messages: transcript,
      tools,
      ...(providerOptions ? { providerOptions } : {}),
    })
    track(trace, res.usage)
    const text = stripMachineryLeak(res.text).trim()
    if (text) {
      if (trace.firstTextAt === undefined) trace.firstTextAt = trace.calls.length
      trace.texts.push(text)
      said = text
    }
    if (res.toolCalls.length === 0) {
      if (res.text) transcript.push({ role: 'assistant', content: [{ type: 'text', text: res.text }] })
      return said
    }
    transcript.push({
      role: 'assistant',
      content: [
        ...(res.text ? [{ type: 'text' as const, text: res.text }] : []),
        ...res.toolCalls.map((tc) => ({
          type: 'tool-call' as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.input,
        })),
      ],
    })
    for (const tc of res.toolCalls) {
      const input = (tc.input ?? {}) as Record<string, unknown>
      trace.calls.push({ agent: agentId, name: tc.toolName, input })
      if (TOOL_REGISTRY[tc.toolName]?.capability === 'write') {
        trace.wrote = true
        return said
      }
      transcript.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            output: { type: 'json', value: fixture(c, scenario, tc.toolName, input) as never },
          },
        ],
      })
    }
  }
  return said
}

async function runCase(c: EvalCase): Promise<Trace> {
  const scenario = c.scenario ?? 'monad'
  const wallet = { ...scenarioWallet(scenario), ...(c.wallet ?? {}) } as WalletContext
  const history: ModelMessage[] = (c.history ?? []).map((m) => ({ role: m.role, content: m.content }))
  const request: ModelMessage[] = [...history, { role: 'user', content: c.user }]
  const transcript: ModelMessage[] = [...request]
  const trace: Trace = { routes: [], calls: [], texts: [], wrote: false, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, modelCalls: 0 }

  const core = AGENT_CONFIGS.core
  const coreOptions = providerOptionsFor(core.model, core.effort)
  const ledger: StepResult[] = []
  const ranInPriorHop = new Set<string>()

  for (let hop = 0; hop < MAX_COORDINATION_HOPS; hop++) {
    const base = core.buildSystemPrompt()
    const system = hop > 0 ? `${base}\n\n${CORE_CONTINUATION_NOTE}\n\n${formatStepLedger(ledger)}` : base
    const res = await callModel({
      model: resolveModel(core.model),
      system,
      messages: request,
      tools: buildSchemaToolSet(core.tools),
      ...(coreOptions ? { providerOptions: coreOptions } : {}),
    })
    track(trace, res.usage)
    const decision = decideCoreRoute(
      res.toolCalls.map((tc) => ({ toolName: tc.toolName, input: tc.input })),
      listSpecialistIds(),
      c.user,
    )
    if (decision.kind === 'answered') {
      if (hop === 0) {
        const clarify = res.toolCalls.find((t) => t.toolName === 'core_clarify')
        const q = (clarify?.input as { question?: string } | undefined)?.question
        trace.coreAnswer = stripMachineryLeak(res.text || q || '').trim()
        if (trace.coreAnswer) trace.texts.push(trace.coreAnswer)
      }
      return trace
    }

    const ranThisHop: string[] = []
    for (const step of decision.steps) {
      if (ranInPriorHop.has(step.to)) continue
      trace.routes.push(step.to)
      ranThisHop.push(step.to)
      const said = await runSpecialist(c, scenario, wallet, step.to, step.brief, transcript, trace)
      ledger.push({ to: step.to, brief: step.brief, status: 'ran', summary: said.slice(0, 400) })
      if (trace.wrote) return trace
    }
    if (ranThisHop.length === 0) return trace
    for (const id of ranThisHop) ranInPriorHop.add(id)
  }
  return trace
}

// ── Judging ───────────────────────────────────────────────────────────────

/** Read `a.b.c` out of a tool input. */
function pick(input: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined),
    input,
  )
}

function sameValue(key: string, got: unknown, want: string): boolean {
  if (want === '!absent') return got === undefined || got === null || got === ''
  if (want === '!present') return !(got === undefined || got === null || got === '')
  return want.split('|').some((opt) => {
    const g = String(got ?? '')
    const numeric = opt.trim() !== '' && !Number.isNaN(Number(opt)) && !Number.isNaN(Number(g)) && g !== ''
    return numeric ? Number(g) === Number(opt) : g.toLowerCase() === opt.toLowerCase()
  })
}

function judge(c: EvalCase, t: Trace): string[] {
  const fails: string[] = []
  const names = t.calls.map((x) => x.name)
  const has = (spec: string) => spec.split('|').some((n) => names.includes(n))

  const wantRoutes = c.expect_routes ?? (c.expect_route ? [c.expect_route] : undefined)
  if (wantRoutes && wantRoutes.length > 0 && t.routes.length === 0) {
    fails.push(`Core answered instead of routing: ${(t.coreAnswer ?? '').slice(0, 140)}`)
  } else if (wantRoutes && t.routes.join(',') !== wantRoutes.join(',')) {
    fails.push(`routes [${t.routes.join(', ')}], expected [${wantRoutes.join(', ')}]`)
  }
  if (c.expect_routes_unordered) {
    const got = [...t.routes].sort().join(',')
    const want = [...c.expect_routes_unordered].sort().join(',')
    if (got !== want) fails.push(`routes {${got}}, expected {${want}}`)
  }

  for (const spec of c.expect_tools ?? []) if (!has(spec)) fails.push(`never called ${spec}`)

  const beforeText = t.firstTextAt === undefined ? names : names.slice(0, t.firstTextAt)
  for (const spec of c.expect_tools_before_text ?? []) {
    if (!spec.split('|').some((n) => beforeText.includes(n))) fails.push(`did not call ${spec} before replying`)
  }

  if (c.expect_tool_order) {
    let from = 0
    for (const spec of c.expect_tool_order) {
      const idx = names.findIndex((n, i) => i >= from && spec.split('|').includes(n))
      if (idx === -1) {
        fails.push(`tool order broken at ${spec} (calls: ${names.join(' → ') || 'none'})`)
        break
      }
      from = idx + 1
    }
  }

  if (c.expect_first_tool && names[0] !== c.expect_first_tool) {
    fails.push(`first tool ${names[0] ?? '(none)'}, expected ${c.expect_first_tool}`)
  }

  const last = t.calls.at(-1)
  if (c.expect_final_tool && last?.name !== c.expect_final_tool) {
    fails.push(`final tool ${last?.name ?? '(none)'}, expected ${c.expect_final_tool}`)
  }
  if (c.expect_final_input && last) {
    for (const [k, v] of Object.entries(c.expect_final_input)) {
      const got = pick(last.input, k)
      if (!sameValue(k, got, v)) fails.push(`${last.name}.${k}=${JSON.stringify(got)}, expected ${v}`)
    }
  }
  for (const [tool, fields] of Object.entries(c.expect_input ?? {})) {
    const call = t.calls.find((x) => x.name === tool)
    if (!call) {
      fails.push(`never called ${tool}`)
      continue
    }
    for (const [k, v] of Object.entries(fields)) {
      const got = pick(call.input, k)
      if (!sameValue(k, got, v)) fails.push(`${tool}.${k}=${JSON.stringify(got)}, expected ${v}`)
    }
  }

  const noTools = c.expect_no_tool === undefined ? [] : [c.expect_no_tool].flat()
  for (const n of noTools) if (names.includes(n)) fails.push(`called ${n}`)

  for (const [tool, max] of Object.entries(c.expect_max_calls ?? {})) {
    const n = names.filter((x) => x === tool).length
    if (n > max) fails.push(`${tool} called ${n}x (max ${max})`)
  }

  const finalText = t.texts.at(-1) ?? ''
  if (c.expect_question && (t.wrote || !finalText)) fails.push('expected the turn to end asking the user')

  if (c.expect_short_reply && !t.wrote && finalText) {
    const bullets = finalText.split('\n').filter((l) => /^\s*([-*•]|\d+\.)\s/.test(l)).length
    if (finalText.length > 320 || /\|\s*-{3,}/.test(finalText) || bullets > 2) {
      fails.push(`reply not short (${finalText.length} chars, ${bullets} list lines)`)
    }
  }

  const visible = t.texts.join('\n').toLowerCase()
  for (const s of c.forbid_text ?? []) if (visible.includes(s.toLowerCase())) fails.push(`user saw "${s}"`)

  return fails
}

// ── CLI ───────────────────────────────────────────────────────────────────

interface CaseResult {
  id: string
  passed: number
  /** Runs that reached a verdict (excludes infra errors). */
  runs: number
  /** Runs lost to rate limits / timeouts — no verdict. */
  errors?: number
  avgInputTokens: number
  avgCachedInputTokens?: number
  avgOutputTokens: number
  avgModelCalls: number
}

function flagValues(args: string[], flag: string): string[] {
  const out: string[] = []
  args.forEach((a, i) => {
    if (a === flag && args[i + 1]) out.push(args[i + 1])
  })
  return out
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  })
  await Promise.all(workers)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const runs = Number(flagValues(args, '--runs')[0]) || 1
  const concurrency = Number(flagValues(args, '--concurrency')[0]) || 4
  // Default 30 RPM leaves most of the shared org quota to the live app.
  minIntervalMs = Math.ceil(60_000 / (Number(flagValues(args, '--rpm')[0]) || 30))
  const only = flagValues(args, '--case')
  const out = flagValues(args, '--out')[0]
  const compare = flagValues(args, '--compare')[0]

  loadAgentCards()
  const cases = loadCases().filter((c) => only.length === 0 || only.includes(c.id))
  if (cases.length === 0) throw new Error(`no cases matching ${only.join(', ')}`)

  const jobs = cases.flatMap((c) => Array.from({ length: runs }, (_, r) => ({ c, r: r + 1 })))
  const results = new Map<string, { passed: number; valid: number; errors: number; traces: Trace[] }>()
  for (const c of cases) results.set(c.id, { passed: 0, valid: 0, errors: 0, traces: [] })

  await pool(jobs, concurrency, async ({ c, r }) => {
    let trace: Trace | undefined
    let fails: string[]
    const slot = results.get(c.id)!
    try {
      trace = await runCase(c)
      fails = judge(c, trace)
    } catch (err) {
      if (err instanceof InfraError) {
        slot.errors++
        console.log(`ERROR ${c.id} #${r}  (infra, no verdict): ${err.message.slice(0, 120)}`)
        return
      }
      fails = [`error: ${(err as Error).message}`]
    }
    slot.valid++
    if (trace) slot.traces.push(trace)
    if (fails.length === 0) slot.passed++
    const route = trace?.routes.length ? trace.routes.join('+') : 'core'
    const calls = trace?.calls.map((x) => x.name).join(' → ') ?? ''
    console.log(`${fails.length ? 'FAIL' : 'pass'}  ${c.id} #${r}  (${route})  [${calls}]`)
    for (const f of fails) console.log(`        - ${f}`)
    if (fails.length && trace?.texts.length) console.log(`        said: ${trace.texts.at(-1)!.slice(0, 220).replace(/\n/g, ' ')}`)
  })

  const summary: CaseResult[] = cases.map((c) => {
    const { passed, valid, errors, traces } = results.get(c.id)!
    const avg = (f: (t: Trace) => number) =>
      traces.length ? Math.round(traces.reduce((n, t) => n + f(t), 0) / traces.length) : 0
    return {
      id: c.id,
      passed,
      runs: valid,
      errors,
      avgInputTokens: avg((t) => t.inputTokens),
      avgCachedInputTokens: avg((t) => t.cachedInputTokens),
      avgOutputTokens: avg((t) => t.outputTokens),
      avgModelCalls: avg((t) => t.modelCalls),
    }
  })

  const totalRuns = summary.reduce((n, s) => n + s.runs, 0)
  const totalErrors = summary.reduce((n, s) => n + (s.errors ?? 0), 0)
  const totalPassed = summary.reduce((n, s) => n + s.passed, 0)
  const measured = summary.filter((s) => s.runs > 0)
  const meanIn = Math.round(measured.reduce((n, s) => n + s.avgInputTokens, 0) / Math.max(1, measured.length))
  const meanCached = Math.round(
    measured.reduce((n, s) => n + (s.avgCachedInputTokens ?? 0), 0) / Math.max(1, measured.length),
  )
  const hitPct = meanIn ? Math.round((meanCached / meanIn) * 100) : 0
  console.log(
    `\n${totalPassed}/${totalRuns} runs passed · ${totalErrors} infra errors (excluded) · mean input tokens per case ${meanIn} (${hitPct}% from cache)`,
  )

  let regressed = false
  if (compare) {
    const base = JSON.parse(readFileSync(resolve(compare), 'utf8')) as { cases: CaseResult[] }
    const byId = new Map(base.cases.map((b) => [b.id, b]))
    const baseIn = Math.round(base.cases.reduce((n, s) => n + s.avgInputTokens, 0) / base.cases.length)
    console.log(`vs baseline: input tokens ${baseIn} → ${meanIn} (${Math.round(((meanIn - baseIn) / baseIn) * 100)}%)`)
    for (const s of summary) {
      const b = byId.get(s.id)
      if (!b) continue
      // A case with no valid runs on either side has no verdict to compare.
      if (!b.runs || !s.runs) continue
      const was = b.passed / b.runs
      const now = s.passed / s.runs
      if (now < was) {
        regressed = true
        console.log(`  REGRESSION ${s.id}: ${b.passed}/${b.runs} → ${s.passed}/${s.runs}`)
      }
    }
    if (!regressed) console.log('  no case scored below baseline')
  }

  if (out) {
    const path = resolve(out)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), runs, cases: summary }, null, 2)}\n`)
    console.log(`wrote ${path}`)
  }
  process.exit(totalPassed < totalRuns || regressed ? 1 : 0)
}

void main()
