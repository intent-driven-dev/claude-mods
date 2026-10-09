import { describe, expect, test } from 'claude-code/testing'

import {
  artifactForPath,
  buildSteps,
  changeFromPath,
  changeStage,
  chooseActive,
  currentTaskIndex,
  derivePhase,
  parseActive,
  parseJson,
  parseList,
  parseSchemas,
  schemaFromConfig,
  skillVerb,
  statusLine,
  taskWindow,
} from '../hooks/model'
import { CHANGE_ROOT, LIST, NO_ROOT, applyWith, statusWith } from './fixtures'

describe('parsing the CLI', () => {
  test('no root means no OpenSpec project', async () => {
    expect(parseList(NO_ROOT)).toEqual({ hasRoot: false, changes: [] })
  })
  test('JSON after a line of noise still parses', async () => {
    expect(parseJson('warning: x\n{"a":1}')).toEqual({ a: 1 })
  })
})

describe('which change is active', () => {
  const { changes } = parseList(LIST)
  test('pinned wins', async () => expect(chooseActive(changes, 'fix-login', 'add-dark-mode')).toBe('fix-login'))
  test('then the one last named', async () => expect(chooseActive(changes, null, 'fix-login')).toBe('fix-login'))
  test('then the most recent', async () => expect(chooseActive(changes, null, 'gone')).toBe('add-dark-mode'))
})

describe('phase', () => {
  test('tasks artifact not written yet is planning', async () => {
    const active = parseActive('add-dark-mode', statusWith('ready'), applyWith([]))
    expect(derivePhase(active, {})).toBe('plan')
  })
  test('tasks remaining is apply, current is the first undone', async () => {
    const active = parseActive('add-dark-mode', statusWith('done'), applyWith([true, false, false]))
    expect(derivePhase(active, {})).toBe('apply')
    expect(currentTaskIndex(active.tasks)).toBe(1)
  })
  test('all tasks done is verify', async () => {
    const active = parseActive('add-dark-mode', statusWith('done'), applyWith([true, true]))
    expect(derivePhase(active, {})).toBe('verify')
  })
  test('an archive run shows archive for its own change only', async () => {
    const active = parseActive('add-dark-mode', statusWith('done'), applyWith([true, true]))
    expect(derivePhase(active, { skill: 'opsx:archive', hintedChange: 'add-dark-mode' })).toBe('archive')
    expect(derivePhase(active, { skill: 'opsx:archive', hintedChange: 'other' })).toBe('verify')
  })
  test('no change is explore', async () => expect(derivePhase(undefined, {})).toBe('explore'))
  test('skill names map to verbs', async () => {
    expect(skillVerb('opsx:apply')).toBe('apply')
    expect(skillVerb('openspec-apply-change')).toBe('apply')
    expect(skillVerb('openspec-sync-specs')).toBe('sync')
    expect(skillVerb('openspec-bulk-archive-change')).toBe('bulk-archive')
  })
})

describe('paths', () => {
  const active = parseActive('add-dark-mode', statusWith('ready'), applyWith([]))
  test('change from a path', async () => {
    expect(changeFromPath(`${CHANGE_ROOT}/design.md`)).toBe('add-dark-mode')
    expect(changeFromPath('/repo/openspec/changes/archive/2026-x/design.md')).toBeUndefined()
  })
  test('artifact from a path', async () => {
    expect(artifactForPath(`${CHANGE_ROOT}/proposal.md`, active)).toBe('proposal')
    expect(artifactForPath(`${CHANGE_ROOT}/specs/auth/spec.md`, active)).toBe('specs')
    expect(artifactForPath(`${CHANGE_ROOT}/notes.md`, active)).toBeUndefined()
  })
})

test('the task window keeps the current task in view', async () => {
  const tasks = applyWith([true, true, true, true, true, true, false, false, false, false]).tasks.map(t => ({
    id: t.id,
    description: t.description,
    done: t.done,
  }))
  const { start, end } = taskWindow(tasks, 4)
  expect(start <= 6 && 6 < end).toBe(true)
  expect(end - start).toBe(4)
})

describe('steps follow the schema', () => {
  const brief = (steps: ReturnType<typeof buildSteps>) => steps.map(s => `${s.id}:${s.state}`)

  test('each artifact is its own step, in schema order, between explore and apply', async () => {
    const active = parseActive('add-dark-mode', statusWith('ready'), applyWith([]))
    expect(brief(buildSteps(active, {}, undefined))).toEqual([
      'explore:done',
      'plan:current',
      'proposal:done',
      'specs:done',
      'design:done',
      'tasks:current',
      'apply:pending',
      'verify:pending',
      'archive:pending',
    ])
  })

  test('the artifact being written is live; blocked ones say what they need', async () => {
    const status = statusWith('ready')
    status.artifacts[1]!.status = 'ready'
    status.artifacts[2]!.status = 'ready'
    status.artifacts[3]!.status = 'blocked'
    const active = parseActive('add-dark-mode', status, applyWith([]))
    const steps = buildSteps(active, { writingArtifact: 'design' }, undefined)
    expect(brief(steps).slice(2, 6)).toEqual(['proposal:done', 'specs:ready', 'design:writing', 'tasks:blocked'])
    expect(steps.find(s => s.id === 'tasks')?.note).toBe('needs specs, design')
    expect(steps.find(s => s.id === 'plan')?.note).toBe('1/4')
    expect(steps.filter(s => s.isLastChild).map(s => s.id)).toEqual(['tasks'])
    expect(statusLine(active, steps)).toBe('OpenSpec: add-dark-mode · Propose › writing Design')
  })

  test('with no change yet, the schema gives the artifact steps', async () => {
    const schema = parseSchemas(
      parseJson('[{"name":"spec-driven","artifacts":["proposal","specs","design","tasks"]},{"name":"tdd","artifacts":["spec","tests"]}]'),
      schemaFromConfig('# x\nschema: tdd\n'),
    )
    expect(brief(buildSteps(undefined, {}, schema))).toEqual([
      'explore:current',
      'plan:pending',
      'spec:pending',
      'tests:pending',
      'apply:pending',
      'verify:pending',
      'archive:pending',
    ])
  })

  test('during apply the status line counts tasks', async () => {
    const active = parseActive('add-dark-mode', statusWith('done'), applyWith([true, false, false]))
    expect(statusLine(active, buildSteps(active, {}, undefined))).toBe('OpenSpec: add-dark-mode · Apply 1/3')
  })
})

describe('starting and finishing', () => {
  const done = () => parseActive('add-dark-mode', statusWith('done'), applyWith([true, true]))

  test('the journey opens with New / Explore and closes with Sync & Archive', async () => {
    const steps = buildSteps(done(), {}, undefined)
    expect(steps[0]?.label).toBe('New / Explore')
    expect(steps.at(-1)?.label).toBe('Sync & Archive')
  })
  test('starting with /opsx:new (no explore) still ticks the first step once a change exists', async () => {
    const steps = buildSteps(done(), { skill: 'opsx:new', hintedChange: 'add-dark-mode' }, undefined)
    expect(steps[0]?.state).toBe('done')
  })
  test('sync counts as the finishing step, like archive', async () => {
    expect(derivePhase(done(), { skill: 'opsx:sync', hintedChange: 'add-dark-mode' })).toBe('archive')
    expect(derivePhase(done(), { skill: 'openspec-sync-specs' })).toBe('archive')
  })
})

describe('every active change has a stage', () => {
  const at = (completedTasks: number, totalTasks: number) =>
    changeStage({ name: 'x', completedTasks, totalTasks, status: '' })
  test('no tasks yet is Propose', async () => expect(at(0, 0)).toEqual({ label: 'Propose', rank: 0 }))
  test('tasks open is Apply with a count', async () => expect(at(3, 7)).toEqual({ label: 'Apply 3/7', rank: 1 }))
  test('all done is ready to sync and archive', async () =>
    expect(at(7, 7)).toEqual({ label: 'Sync & Archive (ready)', rank: 2 }))
})
