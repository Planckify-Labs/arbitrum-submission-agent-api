/**
 * Agent skills — ported from Claude Code's SKILL.md system.
 *
 * A skill is know-how, not capability: tools say what an agent CAN do, a
 * skill says how to reach a goal with those tools ("pay a person" = resolve
 * the contact → pick the stablecoin → send). Keeping recipes out of the
 * monolithic per-agent system prompt is what stops one fix from silently
 * displacing another.
 *
 * Layout — one folder per skill, next to this file:
 *
 *   src/skills/<name>/SKILL.md     frontmatter + instructions (shipped)
 *   src/skills/<name>/cases.json   regression cases (eval + CI only)
 *
 * SKILL.md frontmatter (all required):
 *
 *   ---
 *   name: pay-a-person            # must equal the folder name
 *   description: One line — WHEN this skill applies. Shown in catalog mode.
 *   agents: [wallet]              # agents allowed to list it
 *   requires_tools: [send_token]  # every listed agent must own these
 *   ---
 *
 * The folder is copied to dist by nest-cli `assets` (like agent manifests),
 * so skills are versioned, reviewed and tested with the code that defines
 * the tools they reference.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface Skill {
  name: string
  description: string
  agents: string[]
  requiresTools: string[]
  /** Instructions below the frontmatter, trimmed. */
  body: string
}

export const SKILLS_DIR = resolve(__dirname)

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function parseList(raw: string, field: string, file: string): string[] {
  const m = raw.match(/^\[(.*)\]$/)
  if (!m) {
    throw new Error(`[skills] ${file}: "${field}" must be a [a, b] list`)
  }
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Parse one SKILL.md. Throws on any malformed or missing field — a broken
 * skill is a boot-time failure, never a silently-skipped recipe.
 */
export function parseSkill(text: string, dirName: string): Skill {
  const file = `${dirName}/SKILL.md`
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!m) throw new Error(`[skills] ${file}: missing --- frontmatter ---`)

  const fields: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx <= 0) throw new Error(`[skills] ${file}: bad frontmatter line "${line}"`)
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }

  for (const key of ['name', 'description', 'agents', 'requires_tools']) {
    if (!fields[key]) throw new Error(`[skills] ${file}: missing "${key}"`)
  }
  if (fields.name !== dirName || !NAME_PATTERN.test(fields.name)) {
    throw new Error(
      `[skills] ${file}: name "${fields.name}" must be kebab-case and equal the folder name`,
    )
  }
  const body = m[2].trim()
  if (body.length === 0) throw new Error(`[skills] ${file}: empty body`)

  const agents = parseList(fields.agents, 'agents', file)
  if (agents.length === 0) throw new Error(`[skills] ${file}: no agents`)

  return {
    name: fields.name,
    description: fields.description,
    agents,
    requiresTools: parseList(fields.requires_tools, 'requires_tools', file),
    body,
  }
}

/** Read every `<dir>/<name>/SKILL.md`. Folders without one are ignored. */
export function loadSkillsFrom(dir: string): Map<string, Skill> {
  const out = new Map<string, Skill>()
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(dir, entry.name, 'SKILL.md')
    if (!existsSync(path)) continue
    const skill = parseSkill(readFileSync(path, 'utf8'), entry.name)
    out.set(skill.name, skill)
  }
  return out
}

let cached: Map<string, Skill> | null = null

/** All shipped skills, read once per process. */
export function allSkills(): ReadonlyMap<string, Skill> {
  if (!cached) cached = loadSkillsFrom(SKILLS_DIR)
  return cached
}

/**
 * Resolve an agent's declared skill names. Throws on an unknown name or a
 * skill that does not list the agent — both are config bugs that CI
 * (`skills.spec.ts`) catches before they ship.
 */
export function skillsForAgent(
  agentId: string,
  names: readonly string[],
): Skill[] {
  const all = allSkills()
  return names.map((name) => {
    const skill = all.get(name)
    if (!skill) throw new Error(`[skills] agent "${agentId}" lists unknown skill "${name}"`)
    if (!skill.agents.includes(agentId)) {
      throw new Error(
        `[skills] agent "${agentId}" lists "${name}", but the skill's agents are [${skill.agents.join(', ')}]`,
      )
    }
    return skill
  })
}
