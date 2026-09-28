import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT_CONFIGS } from '../agents/agentConfig'
import { allSkills, loadSkillsFrom, parseSkill, type Skill, SKILLS_DIR, skillsForAgent } from './loader'
import {
  buildSkillsSection,
  LOAD_SKILL_TOOL_NAME,
  loadSkillResult,
  SKILL_INLINE_BUDGET_CHARS,
  skillMode,
} from './prompt'

/**
 * Skill ⇄ agent ⇄ tool parity. A skill is a recipe written against tool
 * names; if a tool is renamed or an agent loses it, the recipe silently
 * tells the model to call something it doesn't have. These checks make that
 * a CI failure — the same discipline as the mobile registry parity guard.
 */

interface SkillCase {
  id: string
  user: string
  expect_route: string
  expect_tools_before_text?: string[]
  expect_final_tool?: string
  expect_no_tool?: string
  fixtures?: Record<string, unknown>
}

function readCases(name: string): SkillCase[] {
  const path = join(SKILLS_DIR, name, 'cases.json')
  if (!existsSync(path)) return []
  return (JSON.parse(readFileSync(path, 'utf8')) as { cases: SkillCase[] }).cases
}

/** Tools a skill requires that the agent does not own. */
function missingTools(agentTools: Record<string, unknown>, skill: Skill): string[] {
  return skill.requiresTools.filter((t) => !(t in agentTools))
}

const SKILL_MD = (name: string, extra = '') => `---
name: ${name}
description: test skill
agents: [wallet]
requires_tools: [send_token]
${extra}---
Do the thing.
`

describe('skills — shipped set', () => {
  const skills = allSkills()

  it('ships at least one skill and every SKILL.md parses', () => {
    expect(skills.size).toBeGreaterThan(0)
  })

  for (const config of Object.values(AGENT_CONFIGS)) {
    it(`agent "${config.id}": every declared skill resolves and its required tools are owned`, () => {
      const resolved = skillsForAgent(config.id, config.skills)
      for (const skill of resolved) {
        expect({ skill: skill.name, missing: missingTools(config.tools, skill) }).toEqual({
          skill: skill.name,
          missing: [],
        })
      }
    })
  }

  it('no orphan skills — every skill is declared by an agent it lists', () => {
    for (const skill of skills.values()) {
      const users = skill.agents.filter((id) => AGENT_CONFIGS[id]?.skills.includes(skill.name))
      expect({ skill: skill.name, declaredBy: users.length > 0 }).toEqual({
        skill: skill.name,
        declaredBy: true,
      })
    }
  })

  it('every skill ships regression cases that reference real agents and tools', () => {
    for (const skill of skills.values()) {
      const cases = readCases(skill.name)
      expect({ skill: skill.name, hasCases: cases.length > 0 }).toEqual({
        skill: skill.name,
        hasCases: true,
      })
      for (const c of cases) {
        const agent = AGENT_CONFIGS[c.expect_route]
        expect({ case: c.id, route: c.expect_route, known: Boolean(agent) }).toEqual({
          case: c.id,
          route: c.expect_route,
          known: true,
        })
        const named = [
          ...(c.expect_tools_before_text ?? []),
          ...(c.expect_final_tool ? [c.expect_final_tool] : []),
          ...(c.expect_no_tool ? [c.expect_no_tool] : []),
          ...Object.keys(c.fixtures ?? {}),
        ]
        const unknown = named.flatMap((t) => t.split('|')).filter((t) => !(t in agent.tools))
        expect({ case: c.id, unknownTools: unknown }).toEqual({ case: c.id, unknownTools: [] })
      }
    }
  })

  it('capability eval cases (evals/cases) reference real agents, tools and scenarios', () => {
    const dir = join(__dirname, '../../evals/cases')
    const allTools = new Set(Object.values(AGENT_CONFIGS).flatMap((a) => Object.keys(a.tools)))
    const scenarios = ['monad', 'base', 'base_pk', 'sui']
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const { cases } = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
        cases: Array<Record<string, unknown>>
      }
      expect({ file: f, count: cases.length > 0 }).toEqual({ file: f, count: true })
      for (const c of cases) {
        const routes = [
          ...((c.expect_routes as string[]) ?? []),
          ...((c.expect_routes_unordered as string[]) ?? []),
        ]
        const badRoutes = routes.filter((r) => !AGENT_CONFIGS[r] || r === 'core')
        const named = [
          ...((c.expect_tools as string[]) ?? []),
          ...((c.expect_tools_before_text as string[]) ?? []),
          ...((c.expect_tool_order as string[]) ?? []),
          ...[c.expect_first_tool, c.expect_final_tool].filter(Boolean),
          ...[c.expect_no_tool ?? []].flat(),
          ...Object.keys((c.expect_input as object) ?? {}),
          ...Object.keys((c.expect_max_calls as object) ?? {}),
          ...Object.keys((c.fixtures as object) ?? {}),
        ] as string[]
        const unknown = named.flatMap((t) => t.split('|')).filter((t) => !allTools.has(t))
        expect({
          case: c.id,
          badRoutes,
          unknown,
          scenario: scenarios.includes((c.scenario as string) ?? 'monad'),
        }).toEqual({ case: c.id, badRoutes: [], unknown: [], scenario: true })
      }
    }
  })

  it('shipped skills fit inline mode (Kimi does not reliably call load_skill)', () => {
    for (const config of Object.values(AGENT_CONFIGS)) {
      expect({ agent: config.id, mode: skillMode(skillsForAgent(config.id, config.skills)) }).toEqual({
        agent: config.id,
        mode: 'inline',
      })
    }
  })
})

// Prove the guards FAIL on real drift — a parity check that never fires is
// worse than none (it reads as coverage).
describe('skills — guards fail on drift', () => {
  const skill = parseSkill(SKILL_MD('needs-send'), 'needs-send')

  it('missingTools flags a required tool the agent lacks', () => {
    expect(missingTools({ get_wallet_assets: {} }, skill)).toEqual(['send_token'])
    expect(missingTools({ send_token: {} }, skill)).toEqual([])
  })

  it('skillsForAgent rejects an unknown skill and a skill not listing the agent', () => {
    expect(() => skillsForAgent('wallet', ['does-not-exist'])).toThrow(/unknown skill/)
    const walletOnly = [...allSkills().values()].find((s) => !s.agents.includes('defi'))
    if (walletOnly) {
      expect(() => skillsForAgent('defi', [walletOnly.name])).toThrow(/skill's agents/)
    }
  })

  it('parseSkill rejects malformed files', () => {
    expect(() => parseSkill('no frontmatter', 'x')).toThrow(/frontmatter/)
    expect(() => parseSkill(SKILL_MD('a-b'), 'other-folder')).toThrow(/folder name/)
    expect(() => parseSkill(SKILL_MD('a-b').replace('agents: [wallet]', 'agents: wallet'), 'a-b')).toThrow(
      /list/,
    )
    expect(() =>
      parseSkill(SKILL_MD('a-b').replace('description: test skill\n', ''), 'a-b'),
    ).toThrow(/description/)
    expect(() => parseSkill(SKILL_MD('a-b').replace('Do the thing.\n', ''), 'a-b')).toThrow(/empty body/)
  })

  it('loadSkillsFrom reads folders and skips ones without SKILL.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skills-'))
    mkdirSync(join(dir, 'one-skill'))
    writeFileSync(join(dir, 'one-skill', 'SKILL.md'), SKILL_MD('one-skill'))
    mkdirSync(join(dir, 'not-a-skill'))
    const loaded = loadSkillsFrom(dir)
    expect([...loaded.keys()]).toEqual(['one-skill'])
  })
})

describe('skills — prompt modes', () => {
  const small = parseSkill(SKILL_MD('small-one'), 'small-one')
  const big: Skill = { ...small, name: 'big-one', body: 'x'.repeat(SKILL_INLINE_BUDGET_CHARS + 1) }

  it('inlines bodies under budget', () => {
    expect(skillMode([small])).toBe('inline')
    const section = buildSkillsSection([small])
    expect(section).toContain('### Skill: small-one')
    expect(section).toContain('Do the thing.')
    expect(section).not.toContain(LOAD_SKILL_TOOL_NAME)
  })

  it('switches to a catalog + load_skill past budget', () => {
    expect(skillMode([small, big])).toBe('catalog')
    const section = buildSkillsSection([small, big])
    expect(section).toContain('- big-one: test skill')
    expect(section).toContain(LOAD_SKILL_TOOL_NAME)
    expect(section).not.toContain('Do the thing.')
  })

  it('is empty for an agent with no skills', () => {
    expect(buildSkillsSection([])).toBe('')
  })

  it('load_skill returns only the agent’s own skills', () => {
    expect(loadSkillResult([small], { name: 'small-one' })).toEqual({
      status: 'success',
      data: { name: 'small-one', instructions: 'Do the thing.' },
    })
    expect(loadSkillResult([small], { name: 'big-one' })).toEqual({
      status: 'failed',
      error: 'unknown_skill',
    })
    expect(loadSkillResult([small], null)).toEqual({ status: 'failed', error: 'unknown_skill' })
  })
})
