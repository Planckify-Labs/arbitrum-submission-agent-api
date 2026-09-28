/**
 * How an agent's skills reach its model — Claude Code's progressive
 * disclosure, with an inline mode for models that don't reliably load.
 *
 *   inline  — every skill body is in the system prompt. Used while the
 *             agent's skills fit `SKILL_INLINE_BUDGET_CHARS`. Kimi K2 is
 *             weaker than Claude at deciding to load a skill on its own, and
 *             a recipe it never loads is the exact failure skills fix.
 *   catalog — only `name: description` lines are in the prompt, plus a
 *             `load_skill` tool the loop answers in-process (no mobile
 *             round-trip). Kicks in automatically once the budget is
 *             exceeded, so a growing skill set never bloats every turn.
 */

import type { JsonSchemaObject } from '../tools/internal/types'
import type { Skill } from './loader'

/** Total skill-body chars an agent may inline before switching to catalog. */
export const SKILL_INLINE_BUDGET_CHARS = 8_000

export const LOAD_SKILL_TOOL_NAME = 'load_skill'

export type SkillMode = 'inline' | 'catalog'

export function skillMode(skills: readonly Skill[]): SkillMode {
  const total = skills.reduce((n, s) => n + s.body.length, 0)
  return total <= SKILL_INLINE_BUDGET_CHARS ? 'inline' : 'catalog'
}

/** The `## Skills` system-prompt section ('' when the agent has none). */
export function buildSkillsSection(skills: readonly Skill[]): string {
  if (skills.length === 0) return ''
  if (skillMode(skills) === 'inline') {
    const blocks = skills.map(
      (s) => `### Skill: ${s.name}\nUse when: ${s.description}\n\n${s.body}`,
    )
    return `## Skills
When the request matches a skill's "Use when", follow that skill's steps exactly — they override any general habit of asking first.

${blocks.join('\n\n')}`
  }
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`)
  return `## Skills
Before acting on a request that matches one of these, call \`${LOAD_SKILL_TOOL_NAME}\` with its name and follow the steps it returns. Load it silently — never mention skills to the user.

${lines.join('\n')}`
}

export const LOAD_SKILL_INPUT_SCHEMA: JsonSchemaObject = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Skill name from the ## Skills list.' },
  },
  required: ['name'],
  additionalProperties: false,
}

export const LOAD_SKILL_DESCRIPTION =
  'Load the full step-by-step instructions for one of your skills. Call it before acting on a request that matches a skill in your ## Skills list.'

/** In-process result for a `load_skill` call, scoped to the agent's skills. */
export function loadSkillResult(
  skills: readonly Skill[],
  input: unknown,
): { status: 'success'; data: { name: string; instructions: string } } | { status: 'failed'; error: 'unknown_skill' } {
  const name =
    input && typeof input === 'object' && 'name' in input
      ? String((input as { name?: unknown }).name ?? '')
      : ''
  const skill = skills.find((s) => s.name === name)
  if (!skill) return { status: 'failed', error: 'unknown_skill' }
  return { status: 'success', data: { name: skill.name, instructions: skill.body } }
}
